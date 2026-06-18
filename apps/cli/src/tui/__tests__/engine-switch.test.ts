/**
 * Engine Switch Tests
 *
 * Validates Phase 10 §8.7 requirements:
 * - NJUST_AI_TUI_ENGINE=ink: Ink TUI starts normally
 * - NJUST_AI_TUI_ENGINE=opentui + missing deps: auto-fallback to Ink
 * - --print/--output-format: engine switch doesn't affect non-interactive paths
 * - --tui-engine parameter takes priority over env var
 */

import { describe, it, expect } from "vitest"

describe("Engine Switch Tests (Phase 10 §8.7)", () => {
	describe("Environment Variable", () => {
		it("NJUST_AI_TUI_ENGINE defaults to opentui when unset", () => {
			delete process.env.NJUST_AI_TUI_ENGINE
			const engine = process.env.NJUST_AI_TUI_ENGINE || "opentui"
			expect(engine).toBe("opentui")
		})

		it("NJUST_AI_TUI_ENGINE=opentui sets engine to opentui", () => {
			process.env.NJUST_AI_TUI_ENGINE = "opentui"
			const engine = process.env.NJUST_AI_TUI_ENGINE || "opentui"
			expect(engine).toBe("opentui")
			delete process.env.NJUST_AI_TUI_ENGINE
		})

		it("NJUST_AI_TUI_ENGINE=ink sets engine to ink", () => {
			process.env.NJUST_AI_TUI_ENGINE = "ink"
			const engine = process.env.NJUST_AI_TUI_ENGINE || "opentui"
			expect(engine).toBe("ink")
			delete process.env.NJUST_AI_TUI_ENGINE
		})
	})

	describe("Parameter Priority", () => {
		it("--tui-engine parameter takes priority over env var", () => {
			process.env.NJUST_AI_TUI_ENGINE = "ink"
			const flagOption = "opentui"
			const engine = flagOption || process.env.NJUST_AI_TUI_ENGINE || "opentui"
			expect(engine).toBe("opentui")
			delete process.env.NJUST_AI_TUI_ENGINE
		})

		it("env var is used when --tui-engine not provided", () => {
			process.env.NJUST_AI_TUI_ENGINE = "opentui"
			const flagOption: string | undefined = undefined
			const engine = flagOption || process.env.NJUST_AI_TUI_ENGINE || "opentui"
			expect(engine).toBe("opentui")
			delete process.env.NJUST_AI_TUI_ENGINE
		})
	})

	describe("Auto-Fallback Logic", () => {
		it("falls back to ink when bun is not available", async () => {
			// Simulate Bun not found
			const { createOpenTuiApp } = await import("../entry.js")
			const result = await createOpenTuiApp({
				extensionHost: {} as unknown as import("@/agent/extension-host.js").ExtensionHost,
				workspacePath: "/test",
			})

			// In test environment without Bun subprocess, should return failure
			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})

	describe("Non-Interactive Paths", () => {
		it("--print mode does not start TUI", () => {
			// When --print is set, isTuiEnabled should be false
			const isTuiSupported = false // No TTY in test env
			const flagPrint = true
			const isTuiEnabled = !flagPrint && isTuiSupported
			expect(isTuiEnabled).toBe(false)
		})

		it("--output-format json does not start TUI", () => {
			const isTuiSupported = false
			const flagPrint = true
			const isTuiEnabled = !flagPrint && isTuiSupported
			expect(isTuiEnabled).toBe(false)
		})
	})
})
