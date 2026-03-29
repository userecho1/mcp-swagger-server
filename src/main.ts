import { McpServerService } from "./application/services/McpServerService.js";
import { SpecParser } from "./domain/services/SpecParser.js";
import { AxiosBackendInvoker } from "./infrastructure/api/AxiosBackendInvoker.js";
import { OpenApiHttpFetcher } from "./infrastructure/api/OpenApiHttpFetcher.js";
import { McpServerAdapter } from "./infrastructure/mcp/McpServerAdapter.js";

type TransportMode = "stdio" | "sse";

function getArgValue(name: string): string | undefined {
  const flag = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(flag));
  return matched?.slice(flag.length);
}

function resolveTransport(): TransportMode {
  const argTransport = getArgValue("transport");
  const envTransport = process.env.TRANSPORT;
  const candidate = (argTransport ?? envTransport ?? "stdio").toLowerCase();
  return candidate === "sse" ? "sse" : "stdio";
}

function resolveBackendBaseUrl(specUrl: string): string {
  const fromEnv = process.env.BACKEND_BASE_URL;
  if (fromEnv) {
    return fromEnv;
  }

  const parsed = new URL(specUrl);
  return parsed.origin;
}

async function bootstrap(): Promise<void> {
  const specUrl = process.env.SPEC_URL ?? "http://localhost:8080/v3/api-docs";
  const backendBaseUrl = resolveBackendBaseUrl(specUrl);
  const transport = resolveTransport();
  const ssePort = Number(getArgValue("port") ?? process.env.PORT ?? "3001");
  const apiToken = process.env.API_TOKEN;

  const specFetcher = new OpenApiHttpFetcher(specUrl);
  const parser = new SpecParser();
  const backendInvoker = new AxiosBackendInvoker({
    baseUrl: backendBaseUrl,
    apiToken,
  });
  const mcpAdapter = new McpServerAdapter({
    serverName: "swagger-mcp-server",
    serverVersion: "0.1.0",
  });

  const service = new McpServerService(specFetcher, parser, mcpAdapter, backendInvoker);
  await service.initialize();

  if (transport === "sse") {
    await service.startSse(ssePort);
    return;
  }

  await service.startStdio();
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("Failed to start MCP Swagger server:", message);
  process.exit(1);
});