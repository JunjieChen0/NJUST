import { describe, expect, it } from "vitest"

import { ToolResultCache } from "../ToolResultCache"

describe("ToolResultCache", () => {
	it("returns cached values by stable key", () => {
		const cache = new ToolResultCache({ ttlMs: 60_000, maxEntries: 10 })
		const key = cache.makeKey("read_file", { path: "a.ts", limit: 100 })
		cache.set(key, "ok")
		expect(cache.get(key)).toBe("ok")
	})

	it("evicts oldest entry when max size reached", () => {
		const cache = new ToolResultCache({ ttlMs: 60_000, maxEntries: 2 })
		const k1 = cache.makeKey("list_files", { path: "." })
		const k2 = cache.makeKey("search_files", { path: ".", regex: "a" })
		const k3 = cache.makeKey("search_files", { path: ".", regex: "b" })

		cache.set(k1, "1")
		cache.set(k2, "2")
		cache.set(k3, "3")

		expect(cache.get(k1)).toBeUndefined()
		expect(cache.get(k2)).toBe("2")
		expect(cache.get(k3)).toBe("3")
	})
})
