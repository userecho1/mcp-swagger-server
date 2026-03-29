import axios, { type AxiosInstance, type Method } from "axios";
import type { BackendInvoker } from "../../application/ports/BackendInvoker.js";
import type { McpOperationBinding } from "../../domain/entities/McpTool.js";

interface AxiosBackendInvokerConfig {
  baseUrl: string;
  apiToken?: string;
}

export class AxiosBackendInvoker implements BackendInvoker {
  private readonly client: AxiosInstance;

  constructor(private readonly config: AxiosBackendInvokerConfig) {
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 20_000,
    });
  }

  async invoke(operation: McpOperationBinding, args: Record<string, unknown>): Promise<unknown> {
    const query: Record<string, unknown> = {};
    const headerParams: Record<string, unknown> = {};
    let resolvedPath = operation.path;

    for (const binding of operation.parameterBindings) {
      const value = args[binding.argName];
      if (value === undefined || value === null) {
        continue;
      }

      if (binding.in === "path") {
        resolvedPath = resolvedPath.replace(`{${binding.paramName}}`, encodeURIComponent(String(value)));
      }

      if (binding.in === "query") {
        query[binding.paramName] = value;
      }

      if (binding.in === "header") {
        headerParams[binding.paramName] = value;
      }
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(headerParams)) {
      headers[key] = String(value);
    }
    if (this.config.apiToken) {
      headers.Authorization = `Bearer ${this.config.apiToken}`;
    }
    if (operation.requestBodyContentType) {
      headers["Content-Type"] = operation.requestBodyContentType;
    }

    const bodyArgName = operation.requestBodyArgName;
    const data = bodyArgName ? args[bodyArgName] : undefined;

    const response = await this.client.request({
      method: operation.method as Method,
      url: resolvedPath,
      params: query,
      headers,
      data,
    });

    return response.data;
  }
}
