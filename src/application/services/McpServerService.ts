import type { BackendInvoker } from "../ports/BackendInvoker.js";
import type { SpecFetcher } from "../ports/SpecFetcher.js";
import { SpecParser } from "../../domain/services/SpecParser.js";
import { McpServerAdapter } from "../../infrastructure/mcp/McpServerAdapter.js";

export class McpServerService {
  constructor(
    private readonly specFetcher: SpecFetcher,
    private readonly specParser: SpecParser,
    private readonly mcpAdapter: McpServerAdapter,
    private readonly backendInvoker: BackendInvoker,
  ) {}

  async initialize(): Promise<void> {
    const spec = await this.specFetcher.fetchSpec();
    const tools = this.specParser.parse(spec);
    this.mcpAdapter.bindInvoker(this.backendInvoker);
    this.mcpAdapter.registerTools(tools);
  }

  async startStdio(): Promise<void> {
    await this.mcpAdapter.startStdio();
  }

  async startSse(port: number): Promise<void> {
    await this.mcpAdapter.startSse(port);
  }
}
