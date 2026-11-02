import type { CloudAgentProfile } from "../types/profile"
import type { DeferredToolResult } from "../types"

// ─── 通用请求/响应类型 ────────────────────────────────────────────

export interface UniversalTaskRequest {
	goal?: string
	sessionId: string
	workspacePath?: string
	images?: string[]
	runId?: string
	toolResults?: DeferredToolResult[]
}

export interface UniversalPendingTool {
	callId: string
	tool: string
	arguments: Record<string, unknown>
}

/** 响应来自哪个端点：legacy `/v1/run`，或 deferred start/resume */
export type ResponseKind = "legacy" | "deferred"

export interface UniversalTaskResponse {
	runId: string
	status: "pending" | "done"
	pendingTools?: UniversalPendingTool[]
	workspaceOps?: Array<{
		op: "write_file" | "apply_diff"
		path: string
		content?: string
		diff?: string
	}>
	text?: string
	reasoning?: string
	logs?: string[]
	ok?: boolean
	memorySummary?: string
	tokensIn?: number
	tokensOut?: number
	cost?: number
	/** deferred 协议的服务端版本号，用于检测运行中服务端变更 */
	serverRevision?: string
	/** 原始响应，用于透传未知字段 */
	raw?: Record<string, unknown>
	/**
	 * 解析后的业务数据（REST：响应体本身；MCP：content[].text 内的 JSON）。
	 * 业务字段（如 workspace_ops）应从这里读取，而不是 raw。
	 */
	payload?: Record<string, unknown>
}

/** 单次 MCP 工具调用的取消与超时选项 */
export interface McpCallOptions {
	signal?: AbortSignal
	timeoutMs?: number
}

export type EndpointType = "health" | "run" | "deferredStart" | "deferredResume" | "deferredAbort" | "compile"

// ─── MCP 回调处理器（可选） ────────────────────────────────────────

export interface McpCallbackHandler {
	onText?: (content: string) => Promise<void>
	onReasoning?: (content: string) => Promise<void>
	onDone?: (summary: string) => Promise<void>
	onError?: (message: string) => Promise<void>
}

// ─── 适配器接口 ────────────────────────────────────────────────────

/**
 * 协议适配器接口。
 * 只负责协议层转换（请求构建 + 响应解析 + 端点路径 + 认证头），
 * 不负责 HTTP 传输（重试、超时、错误增强等由 CloudAgentClient 处理）。
 */
export interface IProtocolAdapter {
	readonly protocolType: string

	/** 用 Profile 初始化适配器 */
	initialize(profile: CloudAgentProfile): void

	/** 建立连接（MCP 需要，REST 为空实现） */
	connect(): Promise<void>

	/** 断开连接（MCP 需要，REST 为空实现） */
	disconnect(): Promise<void>

	/** 构建请求体（协议层） */
	buildRequestBody(request: UniversalTaskRequest): Record<string, unknown>

	/**
	 * 解析响应体（协议层）。包含 pending_tools/tool_calls 归一化。
	 * kind 为 "deferred" 时响应必须符合 deferred 协议，校验失败直接抛错（不回退为 done）。
	 */
	parseResponseBody(data: Record<string, unknown>, kind?: ResponseKind): UniversalTaskResponse

	/** 获取端点路径（不含 serverUrl 前缀） */
	getEndpoint(type: EndpointType): string

	/** 构建认证头（不包含 Content-Type，由 Client 添加） */
	buildAuthHeaders(): Record<string, string>

	// ─── MCP 可选方法（REST 适配器无需实现） ─────────────────────────

	/** 设置 MCP 回调处理器（仅 MCP 适配器需要） */
	setCallbackHandler?(handler: McpCallbackHandler): void

	/** 调用 MCP 工具（仅 MCP 适配器需要） */
	callTool?(name: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<UniversalTaskResponse>

	/** 解析编译响应（仅 MCP 适配器需要） */
	parseCompileResponse?(data: Record<string, unknown>): { success: boolean; output: string }
}
