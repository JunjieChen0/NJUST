import { describe, it, expect, beforeEach } from "vitest"
import { ShortTermMemory } from "../ShortTermMemory"

describe("ShortTermMemory", () => {
	let stm: ShortTermMemory

	beforeEach(() => {
		stm = new ShortTermMemory(100)
	})

	it("starts empty", () => {
		expect(stm.getEntries()).toHaveLength(0)
		expect(stm.charCount).toBe(0)
	})

	it("push adds entries and tracks charCount", () => {
		stm.push("user", "hello")
		stm.push("assistant", "world")
		expect(stm.getEntries()).toHaveLength(2)
		expect(stm.charCount).toBe(10)
	})

	it("summarize formats entries as role: content lines", () => {
		stm.push("user", "hi")
		stm.push("assistant", "hello")
		expect(stm.summarize()).toBe("user: hi\nassistant: hello")
	})

	it("summarize returns empty string when no entries", () => {
		expect(stm.summarize()).toBe("")
	})

	it("clear resets entries and charCount", () => {
		stm.push("user", "some text")
		stm.clear()
		expect(stm.getEntries()).toHaveLength(0)
		expect(stm.charCount).toBe(0)
	})

	it("evicts oldest entries when maxChars exceeded", () => {
		// maxChars=10, push 3 entries of 5 chars each
		const small = new ShortTermMemory(10)
		small.push("user", "12345") // 5 chars
		small.push("user", "67890") // 5 chars, total=10, ok
		small.push("user", "abcde") // 5 chars, total=15 > 10 → evict first
		const entries = small.getEntries()
		expect(entries[0]!.content).toBe("67890")
		expect(entries[1]!.content).toBe("abcde")
		expect(entries).toHaveLength(2)
	})

	it("preserves at least one entry even if it exceeds maxChars", () => {
		const tiny = new ShortTermMemory(3)
		tiny.push("user", "hello") // 5 chars > 3 max
		expect(tiny.getEntries()).toHaveLength(1)
		expect(tiny.getEntries()[0]!.content).toBe("hello")
	})

	it("getEntries returns readonly array", () => {
		stm.push("user", "test")
		const entries = stm.getEntries()
		expect(entries).toHaveLength(1)
	})

	it("entries have correct role and timestamp fields", () => {
		const before = Date.now()
		stm.push("assistant", "response")
		const after = Date.now()
		const entry = stm.getEntries()[0]!
		expect(entry.role).toBe("assistant")
		expect(entry.content).toBe("response")
		expect(entry.timestamp).toBeGreaterThanOrEqual(before)
		expect(entry.timestamp).toBeLessThanOrEqual(after)
	})
})
