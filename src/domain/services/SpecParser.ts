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

const REQUEST_BODY_CONTENT_TYPE_PRIORITY = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
] as const;

export class SpecParser {
  private currentSpec?: OpenApiSpec;
  private zodSchemaCache = new Map<string, z.ZodTypeAny>();
  private jsonSchemaCache = new Map<string, Record<string, unknown>>();
  private inProgressZodCache = new Set<string>();
  private inProgressJsonCache = new Set<string>();
  private schemaObjectIds = new WeakMap<OpenApiSchema, number>();
  private schemaObjectIdSequence = 0;

  parse(spec: OpenApiSpec): McpTool[] {
    this.currentSpec = spec;
    this.resetSchemaCaches();
    const tools: McpTool[] = [];

    try {
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
    } finally {
      this.currentSpec = undefined;
      this.resetSchemaCaches();
    }
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
    const bodySelection = this.selectRequestBodySchema(requestBody?.content);
    if (bodySelection) {
      requestBodyArgName = this.uniqueArgName("body", usedArgNames);
      requestBodyContentType = bodySelection.contentType;
      const normalizedBodySchema = this.normalizeRequestBodySchema(
        bodySelection.schema,
        bodySelection.contentType,
      );
      const zodSchema = this.mapSchemaToZod(normalizedBodySchema);
      shape[requestBodyArgName] = requestBody?.required ? zodSchema : zodSchema.optional();
      jsonProperties[requestBodyArgName] = this.toJsonSchema(normalizedBodySchema);
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
    const resolvedSchema = this.resolveSchema(schema);
    if (!resolvedSchema) {
      return z.any();
    }

    const cacheKey = this.getSchemaCacheKey(schema, resolvedSchema);
    if (cacheKey) {
      const cached = this.zodSchemaCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      if (this.inProgressZodCache.has(cacheKey)) {
        return z.lazy(() => this.zodSchemaCache.get(cacheKey) ?? z.any());
      }
      this.inProgressZodCache.add(cacheKey);
    }

    let built: z.ZodTypeAny;
    if (resolvedSchema.enum && resolvedSchema.enum.length > 0) {
      const literals = resolvedSchema.enum.map((item) => z.literal(item));
      if (literals.length === 1) {
        built = literals[0];
      } else {
        const [first, second, ...rest] = literals;
        built = z.union([first, second, ...rest]);
      }
    } else {
      switch (resolvedSchema.type) {
        case "string":
          built = z.coerce.string();
          break;
        case "integer":
          built = z.coerce.number().int();
          break;
        case "number":
          built = z.coerce.number();
          break;
        case "boolean":
          built = z.coerce.boolean();
          break;
        case "array": {
          const itemSchema = this.mapSchemaToZod(resolvedSchema.items);
          built = z.array(itemSchema);
          break;
        }
        case "object": {
          const properties = resolvedSchema.properties ?? {};
          const required = new Set(resolvedSchema.required ?? []);
          const childShape: z.ZodRawShape = {};

          for (const [key, childSchema] of Object.entries(properties)) {
            const child = this.mapSchemaToZod(childSchema);
            childShape[key] = required.has(key) ? child : child.optional();
          }

          const hasProperties = Object.keys(properties).length > 0;
          const additional = resolvedSchema.additionalProperties;
          const resolvedAdditional =
            additional && typeof additional === "object" ? this.resolveSchema(additional) : undefined;

          if (!hasProperties) {
            if (this.isLooseObjectSchema(resolvedAdditional)) {
              built = z.record(z.any());
              break;
            }
            if (resolvedAdditional) {
              built = z.record(this.mapSchemaToZod(resolvedAdditional));
              break;
            }
            if (additional === true || additional === undefined) {
              built = z.record(z.any());
              break;
            }
            built = z.object({}).strict();
            break;
          }

          const objectSchema = z.object(childShape);
          if (this.isLooseObjectSchema(resolvedAdditional)) {
            built = objectSchema.catchall(z.any());
            break;
          }
          if (resolvedAdditional) {
            built = objectSchema.catchall(this.mapSchemaToZod(resolvedAdditional));
            break;
          }
          if (additional === true) {
            built = objectSchema.catchall(z.any());
            break;
          }
          if (additional === false) {
            built = objectSchema.strict();
            break;
          }

          built = objectSchema;
          break;
        }
        default:
          built = z.any();
          break;
      }
    }

    if (cacheKey) {
      this.zodSchemaCache.set(cacheKey, built);
      this.inProgressZodCache.delete(cacheKey);
    }
    return built;
  }

  private selectRequestBodySchema(
    content?: Record<string, { schema?: OpenApiSchema }>,
  ): { contentType: string; schema: OpenApiSchema } | undefined {
    if (!content) {
      return undefined;
    }

    for (const preferredType of REQUEST_BODY_CONTENT_TYPE_PRIORITY) {
      const schema = content[preferredType]?.schema;
      if (schema) {
        return {
          contentType: preferredType,
          schema,
        };
      }
    }

    for (const [contentType, mediaType] of Object.entries(content)) {
      if (mediaType.schema) {
        return {
          contentType,
          schema: mediaType.schema,
        };
      }

      // Some generators omit schema for form bodies; provide a permissive fallback.
      if (contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data") {
        return {
          contentType,
          schema: {
            type: "object",
            additionalProperties: true,
          },
        };
      }
    }

    return undefined;
  }

  private toJsonSchema(schema?: OpenApiSchema): Record<string, unknown> {
    const resolvedSchema = this.resolveSchema(schema);
    if (!resolvedSchema) {
      return {};
    }

    const cacheKey = this.getSchemaCacheKey(schema, resolvedSchema);
    if (cacheKey) {
      const cached = this.jsonSchemaCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      if (this.inProgressJsonCache.has(cacheKey)) {
        return {};
      }
      this.inProgressJsonCache.add(cacheKey);
    }

    const jsonSchema: Record<string, unknown> = {};
    if (resolvedSchema.type) {
      jsonSchema.type = resolvedSchema.type;
    }
    if (resolvedSchema.description) {
      jsonSchema.description = resolvedSchema.description;
    }
    if (resolvedSchema.enum) {
      jsonSchema.enum = resolvedSchema.enum;
    }
    if (resolvedSchema.default !== undefined) {
      jsonSchema.default = resolvedSchema.default;
    }
    if (resolvedSchema.format) {
      jsonSchema.format = resolvedSchema.format;
    }
    if (resolvedSchema.nullable) {
      const currentType = jsonSchema.type;
      if (typeof currentType === "string") {
        jsonSchema.type = [currentType, "null"];
      }
    }

    if (resolvedSchema.type === "array") {
      jsonSchema.items = this.toJsonSchema(resolvedSchema.items);
    }

    if (resolvedSchema.type === "object") {
      const properties = resolvedSchema.properties ?? {};
      const jsonProperties: Record<string, unknown> = {};
      for (const [key, childSchema] of Object.entries(properties)) {
        jsonProperties[key] = this.toJsonSchema(childSchema);
      }
      jsonSchema.properties = jsonProperties;
      if (resolvedSchema.required && resolvedSchema.required.length > 0) {
        jsonSchema.required = resolvedSchema.required;
      }
      if (typeof resolvedSchema.additionalProperties === "boolean") {
        jsonSchema.additionalProperties = resolvedSchema.additionalProperties;
      } else if (resolvedSchema.additionalProperties) {
        const resolvedAdditional = this.resolveSchema(resolvedSchema.additionalProperties);
        jsonSchema.additionalProperties = this.isLooseObjectSchema(resolvedAdditional)
          ? true
          : this.toJsonSchema(resolvedAdditional);
      }
    }

    if (cacheKey) {
      this.jsonSchemaCache.set(cacheKey, jsonSchema);
      this.inProgressJsonCache.delete(cacheKey);
    }
    return jsonSchema;
  }

  private normalizeRequestBodySchema(schema: OpenApiSchema, contentType: string): OpenApiSchema {
    const resolved = this.resolveSchema(schema) ?? schema;

    if (contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data") {
      return {
        type: "object",
        additionalProperties: {
          type: "string",
        },
      };
    }

    if (contentType === "application/json" && resolved.type === "object") {
      const hasProperties = !!resolved.properties && Object.keys(resolved.properties).length > 0;
      const additional = resolved.additionalProperties;
      const resolvedAdditional =
        additional && typeof additional === "object" ? this.resolveSchema(additional) : undefined;

      if (!hasProperties && resolvedAdditional && this.isLooseObjectSchema(resolvedAdditional)) {
        return {
          ...resolved,
          additionalProperties: true,
        };
      }
    }

    return resolved;
  }

  private resolveSchema(schema?: OpenApiSchema): OpenApiSchema | undefined {
    if (!schema) {
      return undefined;
    }

    if (!schema.$ref) {
      return schema;
    }

    if (!schema.$ref.startsWith("#/components/schemas/")) {
      return schema;
    }

    const schemaName = schema.$ref.replace("#/components/schemas/", "");
    const resolved = this.currentSpec?.components?.schemas?.[schemaName];
    return resolved ?? schema;
  }

  private getSchemaCacheKey(
    sourceSchema: OpenApiSchema | undefined,
    resolvedSchema: OpenApiSchema | undefined,
  ): string | undefined {
    if (sourceSchema?.$ref && sourceSchema.$ref.startsWith("#/components/schemas/")) {
      return `ref:${sourceSchema.$ref}`;
    }
    const target = resolvedSchema ?? sourceSchema;
    if (!target) {
      return undefined;
    }
    return `obj:${this.getSchemaObjectId(target)}`;
  }

  private getSchemaObjectId(schema: OpenApiSchema): number {
    const existing = this.schemaObjectIds.get(schema);
    if (existing !== undefined) {
      return existing;
    }
    const next = this.schemaObjectIdSequence;
    this.schemaObjectIdSequence += 1;
    this.schemaObjectIds.set(schema, next);
    return next;
  }

  private resetSchemaCaches(): void {
    this.zodSchemaCache.clear();
    this.jsonSchemaCache.clear();
    this.inProgressZodCache.clear();
    this.inProgressJsonCache.clear();
    this.schemaObjectIds = new WeakMap<OpenApiSchema, number>();
    this.schemaObjectIdSequence = 0;
  }

  private isLooseObjectSchema(schema?: OpenApiSchema): boolean {
    if (!schema) {
      return false;
    }
    if (schema.type !== "object") {
      return false;
    }
    const hasProperties = !!schema.properties && Object.keys(schema.properties).length > 0;
    const hasAdditional = schema.additionalProperties !== undefined;
    return !hasProperties && !hasAdditional;
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
