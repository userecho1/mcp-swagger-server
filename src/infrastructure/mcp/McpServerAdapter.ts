import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BackendInvoker } from "../../application/ports/BackendInvoker.js";
import type { McpTool } from "../../domain/entities/McpTool.js";

interface AdapterOptions {
  serverName: string;
  serverVersion: string;
  ssePath?: string;
  sseMessagePath?: string;
}

interface SseSession {
  transport: SSEServerTransport;
  server: Server;
}

export class McpServerAdapter {
  private readonly tools = new Map<string, McpTool>();
  private backendInvoker?: BackendInvoker;
  private readonly sseSessions = new Map<string, SseSession>();

  constructor(private readonly options: AdapterOptions) {}

  bindInvoker(invoker: BackendInvoker): void {
    this.backendInvoker = invoker;
  }

  registerTools(tools: McpTool[]): void {
    this.tools.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  async startStdio(): Promise<void> {
    const server = this.createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  async startSse(port: number): Promise<void> {
    const app = express();
    const ssePath = this.options.ssePath ?? "/sse";
    const messagePath = this.options.sseMessagePath ?? "/messages";

    app.use(express.json({ limit: "1mb" }));

    app.get(ssePath, async (_req: Request, res: Response) => {
      const server = this.createServer();
      const transport = new SSEServerTransport(messagePath, res);
      const sessionId = transport.sessionId;
      this.sseSessions.set(sessionId, {
        transport,
        server,
      });

      res.on("close", () => {
        this.sseSessions.delete(sessionId);
      });

      await server.connect(transport);
    });

    app.post(messagePath, async (req: Request, res: Response) => {
      const sessionId = String(req.query.sessionId ?? "");
      const session = this.sseSessions.get(sessionId);
      if (!session) {
        res.status(400).json({
          error: `Unknown sessionId: ${sessionId}`,
        });
        return;
      }

      await session.transport.handlePostMessage(req, res);
    });

    await new Promise<void>((resolve) => {
      app.listen(port, () => {
        resolve();
      });
    });
  }

  private createServer(): Server {
    const server = new Server(
      {
        name: this.options.serverName,
        version: this.options.serverVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [...this.tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputJsonSchema,
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.tools.get(request.params.name);
      if (!tool) {
        return {
          content: [{ type: "text", text: `Tool not found: ${request.params.name}` }],
          isError: true,
        };
      }

      if (!this.backendInvoker) {
        return {
          content: [{ type: "text", text: "Backend invoker not configured." }],
          isError: true,
        };
      }

      const parsedArgs = tool.inputSchema.safeParse((request.params.arguments ?? {}) as Record<string, unknown>);
      if (!parsedArgs.success) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid tool arguments: ${parsedArgs.error.message}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await this.backendInvoker.invoke(tool.operation, parsedArgs.data);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown backend error";
        return {
          content: [{ type: "text", text: `Backend request failed: ${message}` }],
          isError: true,
        };
      }
    });

    return server;
  }
}
