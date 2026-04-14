import { describe, expect, it } from "vitest"

describe("Task system prompt cache inheritance", () => {
	it("keeps Task module importable after cache inheritance changes", async () => {
		const mod = await import("../Task")
		expect(mod).toBeTruthy()
		expect(typeof mod.Task).toBe("function")
	})
})
