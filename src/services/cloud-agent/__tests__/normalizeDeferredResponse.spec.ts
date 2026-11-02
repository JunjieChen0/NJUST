import { describe, it, expect } from "vitest"

import { normalizeDeferredResponse, parseDeferredToolCallItem } from "../normalizeDeferredResponse"

describe("parseDeferredToolCallItem", () => {
	it("parses NJUST deferred shape", () => {
		expect(
			parseDeferredToolCallItem({
				call_id: "c1",
				tool: "read_file",
				arguments: { path: "a.txt" },
			}),
		).toEqual({ call_id: "c1", tool: "read_file", arguments: { path: "a.txt" } })
	})

	it("parses OpenAI tool_calls shape", () => {
		expect(
			parseDeferredToolCallItem({
				id: "call_abc",
				type: "function",
				function: { name: "list_files", arguments: '{"path":"."}' },
			}),
		).toEqual({ call_id: "call_abc", tool: "list_files", arguments: { path: "." } })
	})
})

describe("normalizeDeferredResponse", () => {
	it("fills pending_tools from tool_calls when pending_tools missing", () => {
		const out = normalizeDeferredResponse({
			run_id: "r1",
			status: "pending",
			tool_calls: [
				{ id: "a", function: { name: "t1", arguments: "{}" } },
				{ id: "b", function: { name: "t2", arguments: "{}" } },
			],
		})
		expect(out.pending_tools).toHaveLength(2)
		expect(out.pending_tools![0].tool).toBe("t1")
		expect(out.pending_tools![1].call_id).toBe("b")
	})

	it("keeps pending_tools when already set", () => {
		const out = normalizeDeferredResponse({
			run_id: "r1",
			status: "pending",
			pending_tools: [{ call_id: "x", tool: "read_file", arguments: {} }],
			tool_calls: [{ id: "x", function: { name: "ignored", arguments: "{}" } }],
		})
		expect(out.pending_tools).toHaveLength(1)
		expect(out.pending_tools![0].tool).toBe("read_file")
	})

	it("rejects deferred_protocol_version below supported minimum", () => {
		expect(() => normalizeDeferredResponse({ run_id: "r1", status: "done", deferred_protocol_version: 0 })).toThrow(
			/deferred_protocol_version/,
		)
	})

	it("rejects run_id with newlines or excessive length", () => {
		expect(() => normalizeDeferredResponse({ run_id: "bad\nid", status: "done" })).toThrow(/run_id/)
	})

	describe("field types", () => {
		const base = { run_id: "r1", status: "done" }

		it.each([
			["a status outside pending/done", { status: "running" }],
			["a missing status", { status: undefined }],
			["ok as a string", { ok: "false" }],
			["a string protocol version", { deferred_protocol_version: "2" }],
			["a fractional protocol version", { deferred_protocol_version: 1.5 }],
			["a numeric server_revision", { server_revision: 42 }],
			["text that is not a string", { text: 5 }],
			["reasoning that is not a string", { reasoning: {} }],
			["memory_summary that is not a string", { memory_summary: 1 }],
			["logs with a non-string entry", { logs: ["ok", 1] }],
			["tokens_in as a string", { tokens_in: "10" }],
			["a non-finite cost", { cost: Number.POSITIVE_INFINITY }],
			["pending_tools that is not an array", { pending_tools: "c1" }],
		])("rejects %s", (_label, override) => {
			expect(() => normalizeDeferredResponse({ ...base, ...override })).toThrow()
		})

		const validTool = { call_id: "c1", tool: "read_file", arguments: {} }
		it.each([
			["pending_tools where every entry is invalid", { pending_tools: [{ tool: "read_file" }, "x"] }],
			["pending_tools mixing valid and invalid entries", { pending_tools: [validTool, { call_id: "c2" }] }],
			[
				"tool_calls with an entry missing its id",
				{ tool_calls: [{ function: { name: "t1", arguments: "{}" } }] },
			],
		])("rejects %s instead of dropping entries", (_label, override) => {
			expect(() => normalizeDeferredResponse({ run_id: "r1", status: "pending", ...override })).toThrow(
				/tool call/,
			)
		})

		it("accepts well-typed optional fields", () => {
			const out = normalizeDeferredResponse({
				...base,
				ok: false,
				deferred_protocol_version: 1,
				server_revision: "rev-1",
				text: "t",
				reasoning: "r",
				memory_summary: "m",
				logs: ["a"],
				tokens_in: 1,
				tokens_out: 2,
				cost: 0.5,
			})
			expect(out.ok).toBe(false)
			expect(out.server_revision).toBe("rev-1")
		})
	})
})
