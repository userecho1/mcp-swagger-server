import { z } from "zod";
import type {
  HttpMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
  OpenApiSpec,
} from "../entities/OpenApiSpec.js";
import type { McpTool, ToolParameterBinding } from "../entities/McpTool.js";

const HTTP_METHODS: HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
];

export class SpecParser {
  parse(spec: OpenApiSpec): McpTool[] {
    const tools: McpTool[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) {
          continue;
        }

        const normalized = this.normalizeOperation(path, method, operation, pathItem.parameters ?? []);
        tools.push(normalized);
      }
    }

    return tools;
  }

  private normalizeOperation(
    path: string,
    method: HttpMethod,
    operation: OpenApiOperation,
    inheritedParameters: OpenApiParameter[],
  ): McpTool {
    const operationId = operation.operationId ?? this.buildOperationId(path, method);
    const toolName = this.toToolName(operationId, method, path);
    const description = operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`;

    const mergedParameters = this.mergeParameters(inheritedParameters, operation.parameters ?? []);
    const shape: z.ZodRawShape = {};
    const jsonProperties: Record<string, unknown> = {};
    const required: string[] = [];
    const bindings: ToolParameterBinding[] = [];
    const usedArgNames = new Set<string>();

    for (const parameter of mergedParameters) {
      const argName = this.uniqueArgName(parameter.name, usedArgNames, parameter.in);
      const schema = this.mapSchemaToZod(parameter.schema);
      shape[argName] = parameter.required ? schema : schema.optional();
      jsonProperties[argName] = this.toJsonSchema(parameter.schema);
      if (parameter.required) {
        required.push(argName);
      }
      bindings.push({
        argName,
        paramName: parameter.name,
        in: parameter.in,
      });
    }

    let requestBodyArgName: string | undefined;
    let requestBodyContentType: string | undefined;

    const requestBody = operation.requestBody;
    const jsonBodySchema = requestBody?.content?.["application/json"]?.schema;
    if (jsonBodySchema) {
      requestBodyArgName = this.uniqueArgName("body", usedArgNames);
      requestBodyContentType = "application/json";
      const zodSchema = this.mapSchemaToZod(jsonBodySchema);
      shape[requestBodyArgName] = requestBody?.required ? zodSchema : zodSchema.optional();
      jsonProperties[requestBodyArgName] = this.toJsonSchema(jsonBodySchema);
      if (requestBody?.required) {
        required.push(requestBodyArgName);
      }
    }

    return {
      name: toolName,
      description,
      inputSchema: z.object(shape).strict(),
      inputJsonSchema: {
        type: "object",
        properties: jsonProperties,
        required,
        additionalProperties: false,
      },
      operation: {
        method,
        path,
        operationId,
        parameterBindings: bindings,
        requestBodyArgName,
        requestBodyContentType,
      },
    };
  }

  private mergeParameters(
    inherited: OpenApiParameter[],
    operation: OpenApiParameter[],
  ): OpenApiParameter[] {
    const map = new Map<string, OpenApiParameter>();
    for (const parameter of inherited) {
      map.set(`${parameter.in}:${parameter.name}`, parameter);
    }
    for (const parameter of operation) {
      map.set(`${parameter.in}:${parameter.name}`, parameter);
    }
    return [...map.values()];
  }

  private mapSchemaToZod(schema?: OpenApiSchema): z.ZodTypeAny {
    if (!schema) {
      return z.any();
    }

    if (schema.enum && schema.enum.length > 0) {
      const literals = schema.enum.map((item) => z.literal(item));
      if (literals.length === 1) {
        return literals[0];
      }
      const [first, second, ...rest] = literals;
      return z.union([first, second, ...rest]);
    }

    switch (schema.type) {
      case "string":
        return z.string();
      case "integer":
        return z.number().int();
      case "number":
        return z.number();
      case "boolean":
        return z.boolean();
      case "array": {
        const itemSchema = this.mapSchemaToZod(schema.items);
        return z.array(itemSchema);
      }
      case "object": {
        const properties = schema.properties ?? {};
        const required = new Set(schema.required ?? []);
        const childShape: z.ZodRawShape = {};

        for (const [key, childSchema] of Object.entries(properties)) {
          const child = this.mapSchemaToZod(childSchema);
          childShape[key] = required.has(key) ? child : child.optional();
        }

        return z.object(childShape);
      }
      default:
        return z.any();
    }
  }

  private toJsonSchema(schema?: OpenApiSchema): Record<string, unknown> {
    if (!schema) {
      return {};
    }

    const jsonSchema: Record<string, unknown> = {};
    if (schema.type) {
      jsonSchema.type = schema.type;
    }
    if (schema.description) {
      jsonSchema.description = schema.description;
    }
    if (schema.enum) {
      jsonSchema.enum = schema.enum;
    }
    if (schema.default !== undefined) {
      jsonSchema.default = schema.default;
    }
    if (schema.format) {
      jsonSchema.format = schema.format;
    }
    if (schema.nullable) {
      const currentType = jsonSchema.type;
      if (typeof currentType === "string") {
        jsonSchema.type = [currentType, "null"];
      }
    }

    if (schema.type === "array") {
      jsonSchema.items = this.toJsonSchema(schema.items);
    }

    if (schema.type === "object") {
      const properties = schema.properties ?? {};
      const jsonProperties: Record<string, unknown> = {};
      for (const [key, childSchema] of Object.entries(properties)) {
        jsonProperties[key] = this.toJsonSchema(childSchema);
      }
      jsonSchema.properties = jsonProperties;
      if (schema.required && schema.required.length > 0) {
        jsonSchema.required = schema.required;
      }
      if (typeof schema.additionalProperties === "boolean") {
        jsonSchema.additionalProperties = schema.additionalProperties;
      } else if (schema.additionalProperties) {
        jsonSchema.additionalProperties = this.toJsonSchema(schema.additionalProperties);
      }
    }

    return jsonSchema;
  }

  private buildOperationId(path: string, method: HttpMethod): string {
    const normalizedPath = path
      .replace(/[{}]/g, "")
      .split("/")
      .filter(Boolean)
      .join("_");
    return `${method}_${normalizedPath || "root"}`;
  }

  private toToolName(operationId: string, method: HttpMethod, path: string): string {
    const fallback = this.buildOperationId(path, method);
    const source = operationId || fallback;
    return source
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  private uniqueArgName(rawName: string, used: Set<string>, prefix?: string): string {
    const base = rawName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "arg";

    let candidate = base;
    if (used.has(candidate) && prefix) {
      candidate = `${prefix}_${base}`;
    }

    let index = 1;
    while (used.has(candidate)) {
      candidate = `${base}_${index}`;
      index += 1;
    }

    used.add(candidate);
    return candidate;
  }
}
