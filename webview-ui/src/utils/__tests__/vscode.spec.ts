import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

describe("vscode API wrapper fallback", () => {
	beforeEach(() => {
		localStorage.clear()
		vi.stubGlobal("acquireVsCodeApi", undefined)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.resetModules()
	})

	it("uses localstorage fallback when acquireVsCodeApi is not defined", async () => {
		// Import the real vscode module dynamically so it evaluates with acquireVsCodeApi undefined
		const { vscode } = await import("../vscode")

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		vscode.postMessage({ type: "webviewError", text: "test-error", context: "test-context" })
		expect(consoleSpy).toHaveBeenCalledWith({ type: "webviewError", text: "test-error", context: "test-context" })
		consoleSpy.mockRestore()

		expect(vscode.getState()).toBeUndefined()

		const testState = { foo: "bar" }
		vscode.setState(testState)

		expect(vscode.getState()).toEqual(testState)
		expect(localStorage.getItem("vscodeState")).toBe(JSON.stringify(testState))
	})
})
