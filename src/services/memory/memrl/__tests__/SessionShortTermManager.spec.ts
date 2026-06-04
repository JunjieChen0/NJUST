import { describe, it, expect } from "vitest"
import { SessionShortTermManager } from "../SessionShortTermManager"

describe("SessionShortTermManager", () => {
	it("creates a new STM for unknown taskId", () => {
		const mgr = new SessionShortTermManager()
		const stm = mgr.get("task-1")
		expect(stm).toBeDefined()
		expect(stm.getEntries()).toHaveLength(0)
	})

	it("returns same STM for same taskId", () => {
		const mgr = new SessionShortTermManager()
		const a = mgr.get("task-1")
		a.push("user", "hello")
		const b = mgr.get("task-1")
		expect(b.getEntries()).toHaveLength(1)
	})

	it("delete removes the STM", () => {
		const mgr = new SessionShortTermManager()
		mgr.get("task-1").push("user", "data")
		mgr.delete("task-1")
		// After delete, a fresh STM is returned
		expect(mgr.get("task-1").getEntries()).toHaveLength(0)
	})

	it("size reflects the number of active sessions", () => {
		const mgr = new SessionShortTermManager()
		expect(mgr.size).toBe(0)
		mgr.get("a")
		mgr.get("b")
		expect(mgr.size).toBe(2)
		mgr.delete("a")
		expect(mgr.size).toBe(1)
	})

	it("evicts LRU entry when maxEntries exceeded", () => {
		const mgr = new SessionShortTermManager(2) // max 2 entries
		mgr.get("a").push("user", "alpha")
		mgr.get("b").push("user", "beta")
		// Access 'a' to make it recently used
		mgr.get("a")
		// Add 'c' → should evict 'b' (least recently used)
		mgr.get("c").push("user", "gamma")
		expect(mgr.size).toBe(2)
		// 'b' was evicted, 'a' and 'c' remain
		const bStm = mgr.get("b")
		expect(bStm.getEntries()).toHaveLength(0) // fresh, was evicted
	})
})
