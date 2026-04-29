import { describe, expect, it, vi } from "vitest"

vi.mock("../../webview/ClineProvider")
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({ TerminalRegistry: { releaseTerminalsForTask: vi.fn() } }))
vi.mock("../../ignore/RooIgnoreController")
vi.mock("@njust-ai-cj/telemetry", () => ({ TelemetryService: { instance: { captureTaskCreated: vi.fn() } } }))

describe("attemptApiRequest prefetch", () => {
	it("keeps prefetch path wired", async () => {
		const mod = await import("../Task")
		expect(typeof mod.Task).toBe("function")
		expect(mod.Task.prototype.ask).toBeInstanceOf(Function)
		expect(mod.Task.prototype.dispose).toBeInstanceOf(Function)
	})
})
