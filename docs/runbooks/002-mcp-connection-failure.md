# Runbook 002: MCP 服务器连接故障排查

## 先确认配置来源

通过扩展的 MCP 页面检查功能开关、服务器状态和配置文件。全局配置文件由扩展设置目录提供；项目配置为 `.njust_ai/mcp.json`。项目服务器需要工作区信任，未经信任不会自动启动。

`mcpEnabled` 是扩展状态开关；服务器配置文件使用 `mcpServers` 顶层对象。不要把下面的服务器文件结构当作 VS Code `settings.json` 中的一组裸设置。

```json
{
	"mcpServers": {
		"local-tools": {
			"type": "stdio",
			"command": "node",
			"args": ["/absolute/path/to/server.mjs"],
			"timeout": 60
		}
	}
}
```

路径仅为占位示例，需要替换为已安装服务器的真实路径。

## 传输协议

| 协议            | 配置                                                   | 检查重点                                |
| --------------- | ------------------------------------------------------ | --------------------------------------- |
| stdio           | `type: "stdio"`、`command`、`args`，可选 `cwd` / `env` | 可执行文件、工作目录、依赖、进程 stderr |
| SSE             | `type: "sse"`、`url`，可选 `headers`                   | 服务端路由、认证、连接保持              |
| Streamable HTTP | `type: "streamable-http"`、`url`，可选 `headers`       | MCP 握手、认证、协议版本                |

远程 URL 配置必须显式指定 `type`；不是 `transport`。校验来源为 `src/services/mcp/McpHubConfigSchema.ts`。不要混用 `command` 和 `url` 字段。

## 排查步骤

1. 从 MCP 页面确认服务器已启用，项目配置已获信任，选择重连并保存错误信息。
2. stdio：在相同工作目录检查命令是否能启动，确认参数及环境变量。`ENOENT` 常表示路径或依赖缺失，进程立即退出时查看 stderr。
3. 远程连接：检查 URL、代理、防火墙和凭据。普通 HTTP 请求成功只证明路由可达，仍需完成 MCP 握手、工具发现及一次工具调用。
4. 查看扩展输出和 `Log (Extension Host)`，按 `McpHub`、服务器名称及原始错误定位；不要依赖旧文档中的固定输出通道名称。
5. 超时需区分连接失败与工具执行过慢，再检查服务器的 `timeout`。不要只提高超时来掩盖鉴权或地址错误。

认证信息只在本机配置，分享日志前移除 Token 和敏感请求头。

## 验收

重连成功后核对工具列表，再调用一个只读工具。记录协议类型、配置来源、服务器版本及结果。Cloud Agent 的 MCP 适配器与这里的 MCP 服务器管理入口不同，相关边界见 [AGENTS.md](../../AGENTS.md#cloud-agent-mcp-协议)。
