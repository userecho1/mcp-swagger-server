# MCP Swagger Server 使用说明

## 1. 两种启动命令

以下命令均在项目根目录执行（Windows PowerShell）。

### 1.1 stdio 启动

```powershell
$env:SPEC_URL='http://localhost:8080/v3/api-docs'; $env:BACKEND_BASE_URL='http://localhost:8080'; npm run start
```

说明：
- 该模式用于本地 MCP 客户端通过 stdio 拉起并通信。
- 进程会保持运行并等待客户端连接，这是正常现象。

### 1.2 SSE 启动

```powershell
$env:TRANSPORT='sse'; $env:PORT='3001'; $env:SPEC_URL='http://localhost:8080/v3/api-docs'; $env:BACKEND_BASE_URL='http://localhost:8080'; npm run start
```

说明：
- SSE 地址为 `http://localhost:3001/sse`
- 消息地址为 `http://localhost:3001/messages?sessionId=...`

## 2. 两种 mcpServers JSON 配置

下面给出常见的 `mcpServers` 配置示例。

### 2.1 stdio 配置

```json
{
  "mcpServers": {
    "swagger-stdio": {
      "command": "node",
      "args": ["dist/main.js"],
      "cwd": "D:/file/nodeproject/mcp-swagger-server",
      "env": {
        "SPEC_URL": "http://localhost:8080/v3/api-docs",
        "BACKEND_BASE_URL": "http://localhost:8080"
      }
    }
  }
}
```

如果后端有鉴权，可额外加：

```json
{
  "API_TOKEN": "your_bearer_token"
}
```

### 2.2 SSE 配置

```json
{
  "mcpServers": {
    "swagger-sse": {
      "transport": "sse",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

如果你的客户端使用 `type` 字段，可等价写为：

```json
{
  "mcpServers": {
    "swagger-sse": {
      "type": "sse",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### 2.3 关于 `404 status sending message to /sse`

- 这通常是客户端先尝试新的 HTTP 模式，再自动回退到 legacy SSE 的探测日志。
- 只要随后能够成功建立 SSE 并拿到 `endpoint` 事件，通常不影响使用。
- 当前服务端已增加 `POST /sse` 兼容入口，避免直接 404。

### 2.4 关于 `400 ... stream is not readable`

- 根因通常是服务端已启用 JSON body parser，导致请求流被提前消费，SDK 再次读取时失败。
- 当前版本已在 SSE 路由将 `req.body` 直接传入 SDK，避免二次读取流。
- 若仍出现该提示，优先确认启动的是最新构建：先执行 `npm run build`，再执行启动命令。

## 3. 使用顺序建议

1. 先确认 Spring Boot 可访问：
   - `http://localhost:8080/v3/api-docs`
   - `http://localhost:8080/api/hello`
2. 选择一种方式启动 MCP Server（stdio 或 SSE）。
3. 在 MCP 客户端中填入对应 JSON 配置并连接。
4. 检查工具列表是否包含 hello，再执行测试调用。
