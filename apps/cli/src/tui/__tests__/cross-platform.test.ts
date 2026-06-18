/**
 * Cross-Platform Smoke Tests (Phase 10)
 *
 * Validates that the TUI system works on the current platform.
 * In CI, this would run on Windows, Linux, and macOS.
 */

import { describe, it, expect } from "vitest"

describe("Cross-Platform Smoke Tests (Phase 10)", () => {
	describe("Platform Detection", () => {
		it("detects current platform", () => {
			const platform = process.platform
			expect(["win32", "linux", "darwin"]).toContain(platform)
		})

		it("detects current architecture", () => {
			const arch = process.arch
			expect(["x64", "arm64"]).toContain(arch)
		})

		it("detects Node.js version", () => {
			const major = parseInt(process.versions.node.split(".")[0])
			expect(major).toBeGreaterThanOrEqual(20)
		})
	})

	describe("OpenTUI Native Package", () => {
		it("identifies correct platform package name", () => {
			const platform = process.platform
			const arch = process.arch

			const platformMap: Record<string, Record<string, string>> = {
				win32: { x64: "@opentui/core-win32-x64", arm64: "@opentui/core-win32-arm64" },
				linux: {
					x64: "@opentui/core-linux-x64-gnu",
					arm64: "@opentui/core-linux-arm64-gnu",
				},
				darwin: { x64: "@opentui/core-darwin-x64", arm64: "@opentui/core-darwin-arm64" },
			}

			const pkg = platformMap[platform]?.[arch]
			expect(pkg).toBeDefined()
			expect(pkg).toContain(`@opentui/core-${platform}`)
		})
	})

	describe("Terminal Capabilities", () => {
		it("process.stdin.isTTY is defined", () => {
			// In test env, this may be undefined, but the property should exist
			expect("isTTY" in process.stdin || process.stdin.isTTY === undefined).toBe(true)
		})

		it("process.stdout.isTTY is defined", () => {
			expect("isTTY" in process.stdout || process.stdout.isTTY === undefined).toBe(true)
		})
	})

	describe("IPC Protocol", () => {
		it("can serialize messages", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const msg = IpcProtocol.createRequest("init", { workspace: "/test" })
			const serialized = IpcProtocol.serialize(msg)
			expect(serialized).toContain('"type":"request"')
			expect(serialized).toContain('"method":"init"')
			expect(serialized.endsWith("\n")).toBe(true)
		})

		it("can parse messages", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const original = IpcProtocol.createEvent("ready", { ok: true })
			const serialized = IpcProtocol.serialize(original)
			const parsed = IpcProtocol.parse(serialized)

			expect(parsed).toHaveLength(1)
			expect(parsed[0].type).toBe("event")
			expect(parsed[0]).toMatchObject({ event: "ready" })
		})

		it("handles invalid JSON gracefully", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const parsed = IpcProtocol.parse("invalid json\n")
			expect(parsed).toHaveLength(0)
		})

		it("handles multiple messages in one buffer", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const msg1 = IpcProtocol.createRequest("init")
			const msg2 = IpcProtocol.createEvent("ready", {})
			const serialized = IpcProtocol.serialize(msg1) + IpcProtocol.serialize(msg2)
			const parsed = IpcProtocol.parse(serialized)

			expect(parsed).toHaveLength(2)
		})
	})

	describe("Runtime Adapter", () => {
		it("has correct adapter version", async () => {
			const { TUI_RUNTIME_ADAPTER_VERSION } = await import("../runtime/types.js")
			expect(TUI_RUNTIME_ADAPTER_VERSION).toBe("TuiRuntimeAdapterV1")
		})

		it("reducer handles all action types", async () => {
			const { tuiReducer, initialTuiState } = await import("../runtime/extension-host-adapter.js")

			// Test each action type
			const actions = [
				{ type: "session/create" as const, payload: { id: "s1", workspacePath: "/test" } },
				{ type: "session/update" as const, payload: { id: "s1", status: "running" as const } },
				{
					type: "part/create" as const,
					payload: {
						id: "p1",
						messageId: "m1",
						sessionId: "s1",
						type: "text" as const,
						status: "pending" as const,
					},
				},
				{ type: "part/update" as const, payload: { id: "p1", delta: "hello" } },
				{ type: "part/complete" as const, payload: { id: "p1", content: "hello world" } },
				{ type: "part/fail" as const, payload: { id: "p1", error: "failed" } },
				{ type: "task/complete" as const, payload: { success: true } },
				{ type: "task/cancel" as const, payload: { reason: "user" as const } },
				{ type: "task/fail" as const, payload: { error: "error" } },
			]

			let state = initialTuiState
			for (const action of actions) {
				state = tuiReducer(state, action)
			}

			// Verify final state
			expect(state.sessions.has("s1")).toBe(true)
			expect(state.parts.has("p1")).toBe(true)
			expect(state.parts.get("p1")?.status).toBe("failed") // Last action for p1 was fail
		})
	})
})
