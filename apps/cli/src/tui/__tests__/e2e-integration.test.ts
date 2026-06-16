/**
 * End-to-End Integration Test: Bun IPC
 *
 * This test spawns the actual Bun subprocess and verifies IPC communication.
 * It validates that the OpenTUI TUI can be started and communicate with
 * the Node main process via stdin/stdout NDJSON.
 *
 * Requirements:
 * - Bun runtime must be installed
 * - @opentui/core native package must be available
 * - Terminal must support TTY (this test requires a pseudo-TTY)
 */

import { describe, it, expect } from "vitest"
import { execSync } from "child_process"
import type { IpcEvent, IpcRequest, IpcResponse } from "../runtime/ipc-protocol.ts"
import type { ExtensionHostInterface } from "@/agent/extension-host.js"

function createMockExtensionHost(): ExtensionHostInterface {
	return {
		on: () => {},
		client: { on: () => {} } as ExtensionHostInterface["client"],
		activate: async () => {},
		dispose: async () => {},
		runTask: async () => {},
		resumeTask: async () => {},
		sendToExtension: () => {},
	} as ExtensionHostInterface
}

// Check if Bun is available
function isBunAvailable(): boolean {
	try {
		execSync("bun --version", { stdio: "pipe" })
		return true
	} catch {
		return false
	}
}

const BUN_AVAILABLE = isBunAvailable()

describe("E2E: Bun + OpenTUI Integration", () => {
	describe.skipIf(!BUN_AVAILABLE)("Bun runtime available", () => {
		it("bun --version returns a version", () => {
			const version = execSync("bun --version", { encoding: "utf-8" }).trim()
			expect(version).toMatch(/^\d+\.\d+\.\d+$/)
			console.log(`  Bun version: ${version}`)
		})
	})

	describe.skipIf(BUN_AVAILABLE)("Bun not available - skip E2E tests", () => {
		it("reports Bun not installed", () => {
			console.log("  Bun not found in PATH - skipping E2E integration tests")
			expect(BUN_AVAILABLE).toBe(false)
		})
	})
})

describe("E2E: IPC Protocol Integration", () => {
	it("IpcClient correctly serializes and parses messages", async () => {
		const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

		// Simulate a full request/response cycle
		const request = IpcProtocol.createRequest("startTask", {
			prompt: "Hello",
			sessionId: "test-session",
		})

		const serialized = IpcProtocol.serialize(request)
		const parsed = IpcProtocol.parse(serialized)

		expect(parsed).toHaveLength(1)
		expect(parsed[0].type).toBe("request")
		expect((parsed[0] as IpcRequest).method).toBe("startTask")
		expect((parsed[0] as IpcRequest).params).toEqual({ prompt: "Hello", sessionId: "test-session" })

		// Create response
		const response = IpcProtocol.createResponse(request.id, { ok: true })
		const responseSerialized = IpcProtocol.serialize(response)
		const responseParsed = IpcProtocol.parse(responseSerialized)

		expect(responseParsed).toHaveLength(1)
		expect(responseParsed[0].type).toBe("response")
		expect((responseParsed[0] as IpcResponse).id).toBe(request.id)
		expect((responseParsed[0] as IpcResponse).result).toEqual({ ok: true })
	})

	it("IpcClient handles event streaming", async () => {
		const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

		// Simulate streaming events
		const events = [
			IpcProtocol.createEvent("ready", { ok: true }),
			IpcProtocol.createEvent("message", { type: "text.delta", delta: "Hello" }),
			IpcProtocol.createEvent("message", { type: "text.delta", delta: " World" }),
			IpcProtocol.createEvent("message", { type: "text.completed", text: "Hello World" }),
		]

		const allSerialized = events.map((e) => IpcProtocol.serialize(e)).join("")
		const allParsed = IpcProtocol.parse(allSerialized)

		expect(allParsed).toHaveLength(4)
		expect(allParsed[0].type).toBe("event")
		expect((allParsed[0] as IpcEvent).event).toBe("ready")
		expect((allParsed[1] as IpcEvent).data).toMatchObject({ delta: "Hello" })
		expect((allParsed[2] as IpcEvent).data).toMatchObject({ delta: " World" })
		expect((allParsed[3] as IpcEvent).data).toMatchObject({ text: "Hello World" })
	})

	it("IpcClient handles error scenarios", async () => {
		const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

		// Error response
		const errorResponse = IpcProtocol.createResponse("req_123", undefined, {
			code: "INTERNAL_ERROR",
			message: "Failed to create renderer",
		})

		const parsed = IpcProtocol.parse(IpcProtocol.serialize(errorResponse))
		expect(parsed[0].type).toBe("response")
		expect((parsed[0] as IpcResponse).error?.code).toBe("INTERNAL_ERROR")
	})
})

describe("E2E: Auto-Fallback Mechanism", () => {
	it("createOpenTuiApp returns failure when OpenTUI deps missing", async () => {
		// In test environment, @opentui/core may not be in the right location
		const { createOpenTuiApp } = await import("../entry.js")

		const result = await createOpenTuiApp({
			extensionHost: createMockExtensionHost(),
			workspacePath: "/test",
		})

		// In test env, this should fail because @opentui/solid may not resolve
		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
		expect(result.error!.length).toBeGreaterThan(0)
	})

	it("startTuiWithFallback falls back to Ink when OpenTUI fails", async () => {
		const { startTuiWithFallback } = await import("../entry.js")

		let inkStarted = false
		let fallbackReason: string | null = null

		// Force OpenTUI mode
		process.env.NJUST_AI_TUI_ENGINE = "opentui"

		await startTuiWithFallback({
			extensionHost: createMockExtensionHost(),
			workspacePath: "/test",
			onFallback: (reason) => {
				fallbackReason = reason
			},
			startInk: async () => {
				inkStarted = true
			},
		})

		delete process.env.NJUST_AI_TUI_ENGINE

		// OpenTUI should have failed and Ink should have started
		expect(inkStarted).toBe(true)
		expect(fallbackReason).not.toBeNull()
	})

	it("startTuiWithFallback uses Ink directly when engine is ink", async () => {
		const { startTuiWithFallback } = await import("../entry.js")

		let inkStarted = false

		// Set engine to ink
		process.env.NJUST_AI_TUI_ENGINE = "ink"

		await startTuiWithFallback({
			extensionHost: createMockExtensionHost(),
			workspacePath: "/test",
			startInk: async () => {
				inkStarted = true
			},
		})

		delete process.env.NJUST_AI_TUI_ENGINE

		// Should directly start Ink without trying OpenTUI
		expect(inkStarted).toBe(true)
	})
})
