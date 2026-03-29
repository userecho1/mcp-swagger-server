import type { McpOperationBinding } from "../../domain/entities/McpTool.js";

export interface BackendInvoker {
  invoke(operation: McpOperationBinding, args: Record<string, unknown>): Promise<unknown>;
}
