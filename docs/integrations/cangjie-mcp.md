# 仓颉 MCP 接入

返回[文档导航](../README.md)。MCP 客户端可连接外部仓颉工具服务，工具是否出现由当前模式的 MCP 工具组和服务器连接状态共同决定。

## 配置来源

- 项目级配置：工作区中的 `.njust_ai/mcp.json`，启用前需要明确的工作区信任。
- 全局配置：通过扩展 MCP 页面打开当前设置文件；以实际打开的位置为准，不使用旧文档假设的固定用户目录。

示例只说明结构，不代表仓库已安装同名外部服务。请替换为真实可执行文件与 SDK 路径。

```json
{
	"mcpServers": {
		"cangjie-tools": {
			"type": "stdio",
			"command": "node",
			"args": ["D:/path/to/cangjie-mcp/dist/index.js"],
			"env": { "CANGJIE_HOME": "D:/cangjie" },
			"timeout": 60
		}
	}
}
```

服务器结构与校验来自 `src/services/mcp/McpHubConfigSchema.ts`，根节点必须是 `mcpServers`。远程连接需要显式指定 `type`：

```json
{
	"mcpServers": {
		"cangjie-remote": {
			"type": "streamable-http",
			"url": "https://example.com/mcp"
		}
	}
}
```

认证头按实际服务在本机添加，不写入共享模板。旧式 SSE 使用 `type: "sse"`；不能把字段写成 `transport`，也不能混用 `command` 与 `url`。

## 与其他入口的区别

| 入口                       | 扩展的角色                                             |
| -------------------------- | ------------------------------------------------------ |
| 项目 / 全局 MCP 服务器配置 | 客户端，连接外部工具并向模型暴露工具列表               |
| 扩展内置 MCP Tools Server  | 服务端，向其他客户端暴露本机能力                       |
| Cloud Agent MCP Profile    | 远程任务协议，当前不支持完整的服务端到本地工具回调桥接 |

Cloud Agent 边界见[对接说明](cloud-agent.md)。外接 MCP 服务返回成功也不能替代本地仓颉任务的构建、测试和用户验收。

## 验收

1. 保存配置并确认信任，检查服务器是否连接、工具列表是否发现。
2. 在包含 MCP 工具组的模式中调用一个只读工具，记录结果。
3. 需要执行 `cjpm` / `cjc` 时，另核对 SDK、工作目录、权限及退出码。
4. 连接失败时按 [MCP 排障](../runbooks/002-mcp-connection-failure.md)检查；不要通过扩大权限来掩盖配置问题。

可参考[配置模板](../examples/cangjie-mcp.example.json)。仓颉 Skills、语料检索和代码索引仍按各自设置工作，不由 MCP 连接状态替代。
