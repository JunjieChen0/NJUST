# Cloud Agent 对接

返回[文档导航](../README.md)。本页说明当前 REST 与 MCP 协议边界；字段与默认值以 `src/services/cloud-agent/types.ts`、`types/profile.ts` 和 adapters 为准。

## 配置入口

在扩展设置中选择 Cloud Agent Profile，配置协议、服务地址与认证。源码中的旧式配置前缀为 `njust-ai.cloudAgent.*`；Nightly 使用对应变体的设置入口。Profile 可覆盖 REST 端点及字段映射，下面展示默认协议。

认证由 Profile 决定，支持 Bearer、API Key 或自定义头；兼容路径还可携带设备令牌。不要假定所有服务只使用固定的 `X-API-Key`，也不要把真实凭据放进示例或日志。

## REST 端点

| 请求 | 默认路径                  | 用途                     |
| ---- | ------------------------- | ------------------------ |
| GET  | `/health`                 | 健康检查，成功响应为 2xx |
| POST | `/v1/run`                 | Legacy 单次任务          |
| POST | `/v1/run/deferred/start`  | 开始延期执行             |
| POST | `/v1/run/deferred/resume` | 回传本地工具结果         |
| POST | `/v1/run/deferred/abort`  | 幂等清理服务端会话       |
| POST | `/v1/run/compile`         | 服务端编译反馈           |

REST 默认启用 deferred。设为 legacy 时调用 `/v1/run`；MCP 模式不进入此循环。

### 开始任务

`/v1/run` 和 deferred start 的请求使用任务目标、会话与工作区信息：

```json
{
	"goal": "读取当前仓颉工程并说明入口",
	"session_id": "example-task",
	"workspace_path": "/workspace/project"
}
```

有图片时可增加 `images`。工作区路径用于上下文；服务端返回文件操作并不意味着本地已经写入或获准执行。

### 延期响应与工具回传

服务端需要本地工具时返回：

```json
{
	"run_id": "example-run",
	"status": "pending",
	"pending_tools": [
		{
			"call_id": "read-manifest",
			"tool": "read_file",
			"arguments": { "path": "cjpm.toml" }
		}
	]
}
```

客户端也兼容归一化 `tool_calls`，默认协议字段是 `pending_tools`。本地工具包括读取、写入、差异应用、列表、搜索及命令执行；工具审批、只读限制、路径约束与沙盒仍然生效。

执行后调用 deferred resume：

```json
{
	"run_id": "example-run",
	"session_id": "example-task",
	"tool_results": [{ "call_id": "read-manifest", "content": "manifest content", "is_error": false }]
}
```

重复直至 `status: "done"`，客户端最多迭代 50 轮。结束响应可包含 `ok`、`memory_summary`、`logs`、`tokens_in`、`tokens_out` 和 `cost`。`run_id` 必须保持有效；版本或会话变化按客户端生命周期检查处理，不能伪造完成来绕开校验。

会话结束或取消时通知 deferred abort；服务端应将清理实现为幂等操作。旧服务端缺少此路由时的 404 会被兼容处理。

### Legacy 响应

```json
{
	"ok": true,
	"user_goal": "读取当前仓颉工程并说明入口",
	"memory_summary": "已读取工程入口",
	"logs": []
}
```

`ok` 是服务端报告的业务结果，不是本地构建、测试或用户验收的证据。

## 结构化文件操作

响应可选携带：

```json
{
	"workspace_ops": {
		"version": 1,
		"operations": [{ "op": "write_file", "path": "src/example.cj", "content": "// example\n" }]
	}
}
```

另支持 `apply_diff`，其 `diff` 使用 SEARCH/REPLACE 格式。路径被限制在工作区内；数量和长度限制见 `parseWorkspaceOps.ts`。非法的操作段会被记录并忽略，不能据此宣称操作成功。

`applyRemoteWorkspaceOps` 控制是否应用，`confirmRemoteWorkspaceOps` 控制逐项审批，均默认开启。服务端下发操作不等于获得写入授权。

## 编译反馈与交付验证

服务端编译接口的请求含 `session_id` 和可选 `workspace_path`，响应为：

```json
{ "success": true, "output": "build output" }
```

编译循环由 `compileLoop.enabled` 和 `compileLoop.maxRetries` 控制，默认开启、最多修复 3 次。服务端输出必须如实返回；它不会替代扩展对实际本地代码执行的构建、测试与交付判断。

## MCP 模式

`protocolType: "mcp"` 使用 Streamable HTTP。连接握手后调用 `submit_task`，由服务端在内部收敛执行并返回最终结果；编译调用 `compile` 工具。客户端不运行 REST start/resume 循环。

当前 `cloudagent/executeTool` 回调默认返回错误，不能把 MCP 模式描述成已经支持完整的远程到本地工具桥接。通知与连接清理边界见 [AGENTS.md](../../AGENTS.md#cloud-agent-mcp-协议)。

## 本地联调与验收

```sh
node src/test-cloud-agent-mock.mjs
```

设置服务地址为 `http://127.0.0.1:4000`，使用 Cloud Agent 模式联调。可选密钥环境变量为 `CLOUD_AGENT_MOCK_API_KEY`。这是协议 mock，不证明真实模型、SDK 或远端部署可用。

验收应记录协议、Profile、服务版本、审批/拒绝、取消、实际文件差异及本地验证事实。失败时保留日志和已有成果，不能仅凭 `ok: true` 或模型完成声明认定任务已验证。
