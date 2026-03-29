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

## 3. 使用顺序建议

1. 先确认 Spring Boot 可访问：
   - `http://localhost:8080/v3/api-docs`
   - `http://localhost:8080/api/hello`
2. 选择一种方式启动 MCP Server（stdio 或 SSE）。
3. 在 MCP 客户端中填入对应 JSON 配置并连接。
4. 检查工具列表是否包含 hello，再执行测试调用。
