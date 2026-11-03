import { beforeEach, describe, expect, it, vi } from "vitest"
import { execa } from "execa"
import { createDefaultCangjieCheckDeps, resetSdkInfoCache } from "../CangjieVerificationRunner"
import { resolveCangjieToolPath } from "../../../services/cangjie-lsp/cangjieToolUtils"

vi.mock("execa", () => ({ execa: vi.fn() }))
vi.mock("../../../services/cangjie-lsp/cangjieToolUtils", () => ({
	CJC_CONFIG_KEY: "cangjieLsp.cjcPath",
	resolveCangjieToolPath: vi.fn((tool: string) => `/sdk/bin/${tool}`),
	detectCangjieHome: () => "/sdk",
	buildCangjieToolEnv: () => ({}),
}))

beforeEach(() => {
	vi.clearAllMocks()
	resetSdkInfoCache()
})

describe("SDK environment metadata", () => {
	it("reuses SDK version metadata until configuration invalidates it", async () => {
		vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0, stdout: "Cangjie 1\n" } as never)
		vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0, stdout: "Cangjie 2\n" } as never)
		const deps = createDefaultCangjieCheckDeps()
		await expect(deps.environment()).resolves.toEqual({
			sdkHome: "/sdk",
			sdkVersion: "Cangjie 1",
			cjpmPath: "/sdk/bin/cjpm",
		})
		await expect(deps.sdkInfo()).resolves.toMatchObject({ version: "Cangjie 1" })
		expect(execa).toHaveBeenCalledTimes(1)
		expect(resolveCangjieToolPath).toHaveBeenCalledWith("cjc", "cangjieLsp.cjcPath")

		resetSdkInfoCache()
		await expect(deps.environment()).resolves.toMatchObject({ sdkVersion: "Cangjie 2" })
		expect(execa).toHaveBeenCalledTimes(2)
	})
})
