export type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "head";

export interface OpenApiSchema {
  type?: string;
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  default?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
}

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>> & {
  parameters?: OpenApiParameter[];
};

export interface OpenApiSpec {
  openapi: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths: Record<string, OpenApiPathItem>;
}
