import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ToolUse } from "../../../shared/tools"
import { BaseTool, type ToolCallbacks } from "../BaseTool"

// ── Hoisted mocks ──────────────────────────────────────────────────────
const { recordSecurityMetricMock, startTraceSpanEndMock } = vi.hoisted(() => ({
	recordSecurityMetricMock: vi.fn(),
	startTraceSpanEndMock: vi.fn(),
}))

vi.mock("../../security/metrics", () => ({
	recordSecurityMetric: recordSecurityMetricMock,
	startTraceSpan: vi.fn(() => ({
		traceId: "test-trace",
		spanId: "test-span",
		end: startTraceSpanEndMock,
	})),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: (msg: string) => `ERROR: ${msg}`,
	},
}))

vi.mock("../ToolHookManager", () => ({
	ToolHookManager: {
		instance: {
			hookExecutionOrder: "before-permission",
			runPreHooks: vi.fn().mockResolvedValue({ allow: true }),
			runPostHooks: vi.fn().mockResolvedValue(undefined),
			runFailureHooks: vi.fn().mockResolvedValue(undefined),
			runPermissionDeniedHooks: vi.fn().mockResolvedValue(undefined),
		},
	},
}))

vi.mock("../toolResultBudget", () => ({
	getToolResultBudget: vi.fn(() => ({ singleMax: 10000 })),
	truncateToolResult: vi.fn((content: string) => content.slice(0, 100)),
	estimateTokens: vi.fn((content: string) => Math.ceil(content.length / 4)),
}))

vi.mock("../toolResultStorage", () => ({
	shouldPersistResult: vi.fn(() => false),
	persistToolResult: vi.fn(),
	formatStoredResultMessage: vi.fn((stored: any) => `stored: ${stored.filePath}`),
}))

vi.mock("../helpers/ToolResultCache", () => ({
	toolResultCache: {
		makeKey: vi.fn(() => undefined),
		get: vi.fn(() => undefined),
		set: vi.fn(),
	},
}))

vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
	},
}))

vi.mock("../toolParamValidator", () => ({
	createToolValidator: vi.fn((_schema: any) => ({
		validate: vi.fn((params: any) => {
			// Simple pass-through: always valid unless params has __invalid flag
			if (params?.__invalid) {
				return { valid: false, error: "Schema validation failed" }
			}
			return { valid: true }
		}),
	})),
}))

// ── Test tool implementations ────────────────────────────────────────────

class SimpleTool extends BaseTool<"read_file"> {
	readonly name = "read_file" as const
	executed = false
	executeParams: any = null

	async execute(params: any, _task: any, callbacks: ToolCallbacks): Promise<void> {
		this.executed = true
		this.executeParams = params
		callbacks.pushToolResult("ok")
	}
}

class ReadOnlyTool extends BaseTool<"glob"> {
	readonly name = "glob" as const
	async execute(_params: any, _task: any, callbacks: ToolCallbacks): Promise<void> {
		callbacks.pushToolResult("readonly-ok")
	}
	override isReadOnly(): boolean {
		return true
	}
}

class FailingTool extends BaseTool<"execute_command"> {
	readonly name = "execute_command" as const
	callCount = 0
	override isReadOnly(): boolean {
		return false
	}
	async execute(): Promise<void> {
		this.callCount++
		throw new Error("execution failed")
	}
}

class ValidatingTool extends BaseTool<"write_to_file"> {
	readonly name = "write_to_file" as const
	async execute(_params: any, _task: any, callbacks: ToolCallbacks): Promise<void> {
		callbacks.pushToolResult("written")
	}
	override validateBusinessLogic(params: any): { valid: boolean; error?: string } {
		if (params?.path === "/forbidden") {
			return { valid: false, error: "Cannot write to forbidden path" }
		}
		return { valid: true }
	}
}

class SchemaTool extends BaseTool<"glob"> {
	readonly name = "glob" as const
	protected override get inputSchema() {
		return { safeParse: vi.fn() } as any // just needs to be truthy
	}
	async execute(_params: any, _task: any, callbacks: ToolCallbacks): Promise<void> {
		callbacks.pushToolResult("schema-ok")
	}
}

// ── Helper factory ──────────────────────────────────────────────────────

function makeCallbacks(overrides?: Partial<ToolCallbacks>): ToolCallbacks {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		...overrides,
	}
}

function makeTask(overrides?: any): any {
	return {
		taskId: "test-task",
		cwd: "/workspace",
		api: undefined,
		parentTraceId: "trace-1",
		...overrides,
	}
}

function makeBlock(name: string, overrides?: Partial<ToolUse<any>>): ToolUse<any> {
	return {
		type: "tool_use",
		id: "block-1",
		name,
		partial: false,
		params: {},
		nativeArgs: {},
		...overrides,
	} as ToolUse<any>
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("BaseTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("default method behaviors", () => {
		it("isConcurrencySafe returns false by default", () => {
			const tool = new SimpleTool()
			expect(tool.isConcurrencySafe()).toBe(false)
		})

		it("isReadOnly returns false by default", () => {
			const tool = new SimpleTool()
			expect(tool.isReadOnly()).toBe(false)
		})

		it("isDestructive returns false by default", () => {
			const tool = new SimpleTool()
			expect(tool.isDestructive()).toBe(false)
		})

		it("interruptBehavior returns cancel by default", () => {
			const tool = new SimpleTool()
			expect(tool.interruptBehavior()).toBe("cancel")
		})

		it("userFacingName returns tool name", () => {
			const tool = new SimpleTool()
			expect(tool.userFacingName()).toBe("read_file")
		})

		it("getEagerExecutionDecision returns deferred by default", () => {
			const tool = new SimpleTool()
			expect(tool.getEagerExecutionDecision({})).toBe("deferred")
		})

		it("isPartialArgsStable returns false by default", () => {
			const tool = new SimpleTool()
			expect(tool.isPartialArgsStable({})).toBe(false)
		})

		it("dependsOn returns empty array", () => {
			const tool = new SimpleTool()
			expect(tool.dependsOn).toEqual([])
		})

		it("aliases returns empty array", () => {
			const tool = new SimpleTool()
			expect(tool.aliases).toEqual([])
		})

		it("shouldDefer returns false", () => {
			const tool = new SimpleTool()
			expect(tool.shouldDefer).toBe(false)
		})

		it("searchHint returns undefined", () => {
			const tool = new SimpleTool()
			expect(tool.searchHint).toBeUndefined()
		})

		it("requiresCheckpoint is false by default", () => {
			const tool = new SimpleTool()
			expect(tool.requiresCheckpoint).toBe(false)
		})

		it("maxResultSizeChars is 100000 by default", () => {
			const tool = new SimpleTool()
			expect(tool.maxResultSizeChars).toBe(100_000)
		})
	})

	describe("validateBusinessLogic", () => {
		it("returns valid by default", () => {
			const tool = new SimpleTool()
			expect(tool.validateBusinessLogic({})).toEqual({ valid: true })
		})

		it("can be overridden to detect invalid input", () => {
			const tool = new ValidatingTool()
			expect(tool.validateBusinessLogic({ path: "/ok" })).toEqual({ valid: true })
			expect(tool.validateBusinessLogic({ path: "/forbidden" })).toEqual({
				valid: false,
				error: "Cannot write to forbidden path",
			})
		})
	})

	describe("preprocessInput", () => {
		it("returns params unchanged by default", () => {
			const tool = new SimpleTool()
			const params = { path: "test.ts" }
			expect(tool.preprocessInput(params)).toBe(params)
		})
	})

	describe("backfillObservableInput", () => {
		it("returns original input with empty derived fields", () => {
			const tool = new SimpleTool()
			const params = { path: "test.ts" }
			const result = tool.backfillObservableInput(params)
			expect(result.original).toBe(params)
			expect(result.derived).toEqual({})
		})
	})

	describe("hasPathStabilized", () => {
		it("returns false on first call (no previous path)", () => {
			const tool = new SimpleTool()
			// Access protected method via cast
			expect((tool as any).hasPathStabilized("/some/path")).toBe(false)
		})

		it("returns true when same non-empty path is seen twice", () => {
			const tool = new SimpleTool()
			const fn = (tool as any).hasPathStabilized.bind(tool)
			fn("/some/path")
			expect(fn("/some/path")).toBe(true)
		})

		it("returns false when path changes between calls", () => {
			const tool = new SimpleTool()
			const fn = (tool as any).hasPathStabilized.bind(tool)
			fn("/path/a")
			expect(fn("/path/b")).toBe(false)
		})

		it("returns false when path is empty/undefined", () => {
			const tool = new SimpleTool()
			const fn = (tool as any).hasPathStabilized.bind(tool)
			fn("")
			expect(fn("")).toBe(false)
		})
	})

	describe("resetPartialState", () => {
		it("clears lastSeenPartialPath", () => {
			const tool = new SimpleTool()
			const fn = (tool as any).hasPathStabilized.bind(tool)
			fn("/path")
			tool.resetPartialState()
			// After reset, first call should return false again
			expect(fn("/path")).toBe(false)
		})
	})

	describe("handlePartial", () => {
		it("is a no-op by default", async () => {
			const tool = new SimpleTool()
			const task = makeTask()
			const block = makeBlock("read_file", { partial: true })
			await expect(tool.handlePartial(task, block)).resolves.toBeUndefined()
		})
	})

	describe("handle() - partial message flow", () => {
		it("calls handlePartial when block is partial", async () => {
			const tool = new SimpleTool()
			const handlePartialSpy = vi.spyOn(tool, "handlePartial").mockResolvedValue(undefined)
			const task = makeTask()
			const block = makeBlock("read_file", { partial: true })
			const callbacks = makeCallbacks()

			await tool.handle(task, block, callbacks)

			expect(handlePartialSpy).toHaveBeenCalledWith(task, block)
			expect(tool.executed).toBe(false) // Should not call execute
		})

		it("calls handleError when handlePartial throws non-AskIgnoredError", async () => {
			const tool = new SimpleTool()
			vi.spyOn(tool, "handlePartial").mockRejectedValue(new Error("partial fail"))
			const handleError = vi.fn()
			const callbacks = makeCallbacks({ handleError })
			const task = makeTask()
			const block = makeBlock("read_file", { partial: true })

			await tool.handle(task, block, callbacks)

			expect(handleError).toHaveBeenCalledWith("handling partial read_file", expect.any(Error))
		})
	})

	describe("handle() - parameter parsing", () => {
		it("uses nativeArgs when provided", async () => {
			const tool = new SimpleTool()
			const callbacks = makeCallbacks()
			const task = makeTask()
			const block = makeBlock("read_file", { nativeArgs: { path: "hello.ts" } })

			await tool.handle(task, block, callbacks)

			expect(tool.executed).toBe(true)
			expect(tool.executeParams).toEqual({ path: "hello.ts" })
		})

		it("calls handleError when nativeArgs is missing and params contains XML", async () => {
			const tool = new SimpleTool()
			const handleError = vi.fn()
			const callbacks = makeCallbacks({ handleError })
			const task = makeTask()
			const block = makeBlock("read_file", {
				nativeArgs: undefined,
				params: { content: "<tag>xml</tag>" },
			})

			await tool.handle(task, block, callbacks)

			expect(handleError).toHaveBeenCalled()
			expect(tool.executed).toBe(false)
		})

		it("calls handleError when nativeArgs is missing entirely", async () => {
			const tool = new SimpleTool()
			const handleError = vi.fn()
			const callbacks = makeCallbacks({ handleError })
			const task = makeTask()
			const block = makeBlock("read_file", {
				nativeArgs: undefined,
				params: {},
			})

			await tool.handle(task, block, callbacks)

			expect(handleError).toHaveBeenCalled()
			expect(tool.executed).toBe(false)
		})
	})

	describe("handle() - validation pipeline", () => {
		it("blocks execution when Zod schema validation fails", async () => {
			const tool = new SchemaTool()
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()
			const block = makeBlock("glob", { nativeArgs: { __invalid: true } })

			await tool.handle(task, block, callbacks)

			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("ERROR"))
		})

		it("blocks execution when business logic validation fails", async () => {
			const tool = new ValidatingTool()
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()
			const block = makeBlock("write_to_file", { nativeArgs: { path: "/forbidden" } })

			await tool.handle(task, block, callbacks)

			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Cannot write to forbidden path"))
		})
	})

	describe("handle() - successful execution", () => {
		it("executes the tool and pushes result", async () => {
			const tool = new SimpleTool()
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()
			const block = makeBlock("read_file", { nativeArgs: { path: "test.ts" } })

			await tool.handle(task, block, callbacks)

			expect(tool.executed).toBe(true)
			expect(pushToolResult).toHaveBeenCalled()
		})

		it("records performance metrics after execution", async () => {
			recordSecurityMetricMock.mockClear()
			const tool = new SimpleTool()
			const callbacks = makeCallbacks()
			const task = makeTask()
			const block = makeBlock("read_file", { nativeArgs: {} })

			await tool.handle(task, block, callbacks)

			expect(recordSecurityMetricMock).toHaveBeenCalledWith(
				"tool_exec_duration_ms",
				expect.objectContaining({ tool: "read_file" }),
			)
		})
	})

	describe("handle() - error and retry", () => {
		it("throws error when execution fails for non-readonly tool", async () => {
			const tool = new FailingTool()
			const callbacks = makeCallbacks()
			const task = makeTask()
			const block = makeBlock("execute_command", { nativeArgs: {} })

			await expect(tool.handle(task, block, callbacks)).rejects.toThrow("execution failed")
			expect(tool.callCount).toBe(1) // No retry for non-readonly
		})

		it("retries up to 3 times for readonly tools with retryable errors", async () => {
			const tool = new ReadOnlyTool()
			let attempts = 0
			vi.spyOn(tool, "execute").mockImplementation(async () => {
				attempts++
				const err = new Error("timeout") as any
				err.code = "ETIMEDOUT"
				throw err
			})
			const callbacks = makeCallbacks()
			const task = makeTask()
			const block = makeBlock("glob", { nativeArgs: {} })

			await expect(tool.handle(task, block, callbacks)).rejects.toThrow()
			expect(attempts).toBe(3)
		})

		it("does not retry non-retryable errors even for readonly tools", async () => {
			const tool = new ReadOnlyTool()
			let attempts = 0
			vi.spyOn(tool, "execute").mockImplementation(async () => {
				attempts++
				throw new Error("permanent failure")
			})
			const callbacks = makeCallbacks()
			const task = makeTask()
			const block = makeBlock("glob", { nativeArgs: {} })

			await expect(tool.handle(task, block, callbacks)).rejects.toThrow("permanent failure")
			expect(attempts).toBe(1)
		})
	})

	describe("handle() - abort signal", () => {
		it("aborts execution when abortSignal is already aborted", async () => {
			const tool = new SimpleTool()
			const pushToolResult = vi.fn()
			const controller = new AbortController()
			controller.abort()
			const callbacks = makeCallbacks({ pushToolResult, abortSignal: controller.signal })
			const task = makeTask()
			const block = makeBlock("read_file", { nativeArgs: {} })

			await tool.handle(task, block, callbacks)

			expect(tool.executed).toBe(false)
			expect(pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("cancelled"),
				expect.objectContaining({ isError: true }),
			)
		})
	})

	describe("checkPermissions", () => {
		it("returns true when no rule engine is configured", async () => {
			const tool = new SimpleTool()
			const callbacks = makeCallbacks()
			const result = await tool.checkPermissions({}, callbacks)
			expect(result).toBe(true)
		})

		it("returns true when rule engine allows", async () => {
			const tool = new SimpleTool()
			const callbacks = makeCallbacks()
			const context = {
				ruleEngine: { evaluate: vi.fn().mockReturnValue("allow") } as any,
			}
			const result = await tool.checkPermissions({}, callbacks, context)
			expect(result).toBe(true)
		})

		it("returns false when rule engine denies", async () => {
			const tool = new SimpleTool()
			const callbacks = makeCallbacks()
			const context = {
				ruleEngine: { evaluate: vi.fn().mockReturnValue("deny") } as any,
			}
			const result = await tool.checkPermissions({}, callbacks, context)
			expect(result).toBe(false)
		})

		it("calls askApproval when rule engine returns ask", async () => {
			const tool = new SimpleTool()
			const askApproval = vi.fn().mockResolvedValue(true)
			const callbacks = makeCallbacks({ askApproval })
			const context = {
				ruleEngine: { evaluate: vi.fn().mockReturnValue("ask") } as any,
			}
			const result = await tool.checkPermissions({}, callbacks, context)
			expect(askApproval).toHaveBeenCalledWith("tool")
			expect(result).toBe(true)
		})

		it("returns false when askApproval returns false for ask action", async () => {
			const tool = new SimpleTool()
			const askApproval = vi.fn().mockResolvedValue(false)
			const callbacks = makeCallbacks({ askApproval })
			const context = {
				ruleEngine: { evaluate: vi.fn().mockReturnValue("ask") } as any,
			}
			const result = await tool.checkPermissions({}, callbacks, context)
			expect(result).toBe(false)
		})
	})

	describe("handle() - permission integration", () => {
		it("denies execution when permission check fails", async () => {
			const tool = new SimpleTool()
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask({
				permissionRuleEngine: { evaluate: vi.fn().mockReturnValue("deny") },
			})
			const block = makeBlock("read_file", { nativeArgs: {} })

			await tool.handle(task, block, callbacks)

			expect(tool.executed).toBe(false)
			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Permission denied"))
		})
	})

	describe("getSchemaAdapter", () => {
		it("returns a DualSchemaAdapter instance", () => {
			const tool = new SimpleTool()
			const adapter = tool.getSchemaAdapter()
			expect(adapter).toBeDefined()
			expect(adapter.constructor.name).toBe("DualSchemaAdapter")
		})
	})
})
