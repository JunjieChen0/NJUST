import { describe, expect, it } from "vitest"

import { FileReadCache } from "../FileReadCache"

describe("FileReadCache", () => {
	it("clear does not throw", () => {
		const cache = new FileReadCache(16)
		expect(() => cache.clear()).not.toThrow()
	})

	it("returns cached content when mtime and size are unchanged", async () => {
		const cache = new FileReadCache(16)
		const fullPath = __filename
		const first = await cache.getTextFile(fullPath, 1, 10)
		const second = await cache.getTextFile(fullPath, 1, 10)
		expect(second).toBe(first)
	})
})
