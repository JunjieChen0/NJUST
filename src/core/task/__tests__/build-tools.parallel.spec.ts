import { describe, expect, it } from "vitest"

describe("build-tools parallelization", () => {
	it("keeps build-tools module loadable", async () => {
		const mod = await import("../build-tools")
		expect(mod).toBeTruthy()
		expect(typeof mod.buildNativeToolsArrayWithRestrictions).toBe("function")
	})
})
