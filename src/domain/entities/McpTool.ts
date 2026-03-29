import type { ZodObject, ZodRawShape } from "zod";
import type { HttpMethod } from "./OpenApiSpec.js";

export interface ToolParameterBinding {
  argName: string;
  paramName: string;
  in: "path" | "query" | "header" | "cookie";
}

export interface McpOperationBinding {
  method: HttpMethod;
  path: string;
  operationId: string;
  parameterBindings: ToolParameterBinding[];
  requestBodyArgName?: string;
  requestBodyContentType?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  inputJsonSchema: Record<string, unknown>;
  operation: McpOperationBinding;
}
