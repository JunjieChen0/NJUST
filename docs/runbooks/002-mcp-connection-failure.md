# Runbook 002: MCP 服务器连接故障排查

## 症状

- MCP 工具列表为空或显示 "No servers connected"
- Webview 显示 "MCP server connection failed" 错误
- 特定 MCP 工具调用返回超时或连接重置错误
- 输出面板中出现 "MCP transport error" 或 "stdio process exited"

## 诊断步骤

### 1. 确认 MCP 功能已启用

检查 `settings.json` 中的 MCP 配置：

```json
{
  "mcpEnabled": true,
  "mcpServers": { ... }
}
```

### 2. 检查传输协议

根据服务器配置确定传输类型：

| 协议            | 配置键                                 | 常见场景     |
| --------------- | -------------------------------------- | ------------ |
| stdio           | `command` + `args`                     | 本地进程     |
| SSE             | `url` (Server-Sent Events)             | 远程服务     |
| Streamable HTTP | `url` + `transport: "streamable-http"` | 新式远程服务 |

### 3. stdio 传输排查

```bash
# 直接测试 stdio 进程
<command> <args>
# 检查进程是否正常启动并等待 JSON-RPC 输入

# 检查路径是否正确
which <command>
# Windows 上确认 .cmd/.bat 后缀
```

常见 stdio 错误：

- `ENOENT` — 命令路径不正确或命令未安装
- `EACCES` — 命令无执行权限
- 进程启动后立即退出 — 检查 stderr 输出

### 4. SSE/HTTP 传输排查

```bash
# 测试连接
curl -v <url>
# 检查认证头
curl -H "Authorization: Bearer <token>" <url>
```

常见 HTTP 错误：

- `401/403` — 认证失败，检查 API key 或 OAuth token
- `408/504` — 超时，检查网络和服务器状态
- `CORS` 错误 — 确认服务器允许来自扩展的连接

### 5. 查看 MCP Hub 日志

在 VS Code 输出面板选择 "Njust-AI MCP" 通道，查看：

- 服务器注册和连接状态变更
- 工具发现和 schema 加载结果
- 错误和重连尝试记录

## 解决方案

### stdio 进程无法启动

1. 确认命令已安装且在 PATH 中
2. 使用绝对路径替代相对路径
3. 在 `args` 中添加必要的启动参数
4. 检查 `env` 配置是否包含必要的环境变量

### 认证失败

1. 更新 API key 或 OAuth token
2. 检查 token 是否过期
3. 确认 token 有正确的权限范围

### 超时

1. 增加 `timeout` 配置值
2. 检查网络连接和防火墙规则
3. 确认远程服务器正常运行

### 工具 Schema 不兼容

1. 更新 MCP 服务器到最新版本
2. 检查工具参数 schema 是否符合 MCP 规范
3. 禁用不兼容的工具并联系服务器维护者

## 预防措施

- 配置 MCP 服务器健康检查端点（HTTP 传输）
- 设置合理的连接超时和自动重连策略
- 在 CI 中运行 MCP 服务器可用性检查
- 监控 MCP 连接成功率和延迟遥测
