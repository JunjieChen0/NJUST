import { beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultCangjieCheckDeps, resetSdkInfoCache } from "../CangjieVerificationRunner"
import { resolveCangjieToolPath } from "../../../services/cangjie-lsp/cangjieToolUtils"
const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock("../../../services/sandbox/SandboxExecutionService", () => ({
	SandboxExecutionService: {
		getInstance: () => ({ run, cancel: vi.fn(), getConfiguredBackend: () => "guarded-host" }),
	},
}))
vi.mock("../../../services/cangjie-lsp/cangjieToolUtils", () => ({
	CJC_CONFIG_KEY: "cangjieLsp.cjcPath",
	resolveCangjieToolPath: vi.fn((tool: string) => `/sdk/bin/${tool}`),
	detectCangjieHome: () => "/sdk",
}))
beforeEach(() => {
	vi.clearAllMocks()
	resetSdkInfoCache()
})
describe("SDK environment metadata", () => {
	it("probes through the sandbox and caches until configuration invalidates it", async () => {
		run.mockResolvedValueOnce({ exitCode: 0, output: "Cangjie 1\n" })
		run.mockResolvedValueOnce({ exitCode: 0, output: "Cangjie 2\n" })
		const deps = createDefaultCangjieCheckDeps()
		await expect(deps.environment()).resolves.toMatchObject({
			sdkHome: "/sdk",
			sdkVersion: "Cangjie 1",
			cjpmPath: "/sdk/bin/cjpm",
			backend: "guarded-host",
		})
		await expect(deps.sdkInfo()).resolves.toMatchObject({ version: "Cangjie 1" })
		expect(run).toHaveBeenCalledOnce()
		expect(run).toHaveBeenCalledWith(expect.objectContaining({ source: "local" }))
		expect(resolveCangjieToolPath).toHaveBeenCalledWith("cjc", "cangjieLsp.cjcPath")
		resetSdkInfoCache()
		await expect(deps.environment()).resolves.toMatchObject({ sdkVersion: "Cangjie 2" })
		expect(run).toHaveBeenCalledTimes(2)
	})
})
