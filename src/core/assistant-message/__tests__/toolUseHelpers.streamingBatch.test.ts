import { afterEach, describe, expect, it, vi } from "vitest"
import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import { toolRegistry, ToolRegistryImpl } from "../../tools/ToolRegistry"
import { readFileTool } from "../../tools/ReadFileTool"
import { asMock } from "../../../__tests__/helpers/asMock"

vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError: vi.fn() } }))

import { tryEagerBatch } from "../toolUseHelpers"

afterEach(() => vi.restoreAllMocks())

describe("streaming batch dispatch", () => {
	function setup(partials: boolean[]) {
		const blocks = partials.map((partial, i) => ({
			type: "tool_use",
			name: "read_file",
			id: `call_${i}`,
			params: {},
			nativeArgs: { path: `file_${i}.cj` },
			partial,
		})) as ToolUse[]
		const results: unknown[] = []
		const handle = vi.fn(async (_task, block, callbacks) => {
			// BaseTool handles partial calls as UI updates and produces no tool_result.
			if (!block.partial) callbacks.pushToolResult(`read ${block.nativeArgs.path}`)
		})
		vi.spyOn(toolRegistry, "getConcurrencySafeNames").mockReturnValue(new Set(["read_file"]))
		vi.spyOn(toolRegistry, "get").mockReturnValue({
			isPartialArgsStable: () => true,
			getEagerExecutionDecision: () => "eager",
			handle,
		} as never)
		const task = asMock<Task>({
			providerRef: { deref: () => ({ getState: async () => ({ autoApprovalEnabled: true }) }) },
			api: { getModel: () => ({ info: { contextWindow: 200_000 } }) },
			assistantMessageContent: blocks,
			userMessageContent: results,
			pushToolResultToUserContent: (result: unknown) => results.push(result),
			currentStreamingContentIndex: 0,
			didCompleteReadingStream: true,
			userMessageContentReady: false,
		})
		return { task, blocks, results, handle }
	}

	it("leaves reads with individual approval pending for serial dispatch", async () => {
		const { task, results, handle } = setup([false, false])
		const registry = new ToolRegistryImpl()
		registry.register(readFileTool)
		vi.mocked(toolRegistry.getConcurrencySafeNames).mockReturnValue(registry.getConcurrencySafeNames())
		expect(await tryEagerBatch(task)).toBe(false)
		expect(handle).not.toHaveBeenCalled()
		expect(results).toHaveLength(0)
		expect(task.currentStreamingContentIndex).toBe(0)
		expect(task.userMessageContentReady).toBe(false)
	})

	it.each([
		[true, true],
		[false, true],
	])("keeps unfinished calls pending (%j)", async (...partials) => {
		const { task, blocks, results, handle } = setup(partials)
		expect(await tryEagerBatch(task)).toBe(false)
		expect(task.currentStreamingContentIndex).toBe(0)
		expect(task.userMessageContentReady).toBe(false)
		expect(handle).not.toHaveBeenCalled()
		expect(results).toHaveLength(0)

		blocks.forEach((block) => (block.partial = false))
		expect(await tryEagerBatch(task)).toBe(true)
		expect(handle).toHaveBeenCalledTimes(2)
		expect(results).toHaveLength(2)
		expect(task.currentStreamingContentIndex).toBe(2)
		expect(task.userMessageContentReady).toBe(true)
	})
})
