import { describe, it, expect, beforeEach } from "vitest"

import type { TaskLike } from "@njust-ai/types"
import { TaskStack, type TaskStackEntry } from "../TaskStack"

/** Build a minimal TaskLike stub – only `taskId` is exercised by TaskStack. */
function mockTask(id: string): TaskLike {
	return { taskId: id } as unknown as TaskLike
}

/** Shorthand for building entries. */
function entry(id: string, parentId?: string): TaskStackEntry {
	return { taskId: id, parentTaskId: parentId, task: mockTask(id) }
}

describe("TaskStack", () => {
	let stack: TaskStack

	beforeEach(() => {
		stack = new TaskStack()
	})

	// ── Empty stack edge cases ────────────────────────────────────────

	describe("empty stack", () => {
		it("pop returns undefined", () => {
			expect(stack.pop()).toBeUndefined()
		})

		it("peek returns undefined", () => {
			expect(stack.peek()).toBeUndefined()
		})

		it("current returns undefined", () => {
			expect(stack.current).toBeUndefined()
		})

		it("size is 0", () => {
			expect(stack.size).toBe(0)
		})

		it("findById returns undefined", () => {
			expect(stack.findById("any")).toBeUndefined()
		})

		it("ancestryIds returns empty array", () => {
			expect(stack.ancestryIds()).toEqual([])
		})

		it("toArray returns empty array", () => {
			expect(stack.toArray()).toEqual([])
		})
	})

	// ── push / pop (LIFO) ─────────────────────────────────────────────

	describe("push/pop LIFO behavior", () => {
		it("returns entries in last-in-first-out order", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))
			stack.push(entry("t3"))

			expect(stack.pop()?.taskId).toBe("t3")
			expect(stack.pop()?.taskId).toBe("t2")
			expect(stack.pop()?.taskId).toBe("t1")
			expect(stack.pop()).toBeUndefined()
		})

		it("updates size on each push and pop", () => {
			expect(stack.size).toBe(0)
			stack.push(entry("t1"))
			expect(stack.size).toBe(1)
			stack.push(entry("t2"))
			expect(stack.size).toBe(2)
			stack.pop()
			expect(stack.size).toBe(1)
			stack.pop()
			expect(stack.size).toBe(0)
		})
	})

	// ── peek ──────────────────────────────────────────────────────────

	describe("peek", () => {
		it("returns the top entry without removing it", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))

			expect(stack.peek()?.taskId).toBe("t2")
			// size unchanged – peek is non-destructive
			expect(stack.size).toBe(2)
			// calling peek again yields the same entry
			expect(stack.peek()?.taskId).toBe("t2")
		})
	})

	// ── current ───────────────────────────────────────────────────────

	describe("current", () => {
		it("returns the top entry", () => {
			stack.push(entry("t1"))
			expect(stack.current?.taskId).toBe("t1")

			stack.push(entry("t2"))
			expect(stack.current?.taskId).toBe("t2")
		})

		it("reflects pop operations", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))
			stack.pop()
			expect(stack.current?.taskId).toBe("t1")
		})
	})

	// ── size ──────────────────────────────────────────────────────────

	describe("size", () => {
		it("correctly reflects entry count after mixed operations", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))
			stack.push(entry("t3"))
			expect(stack.size).toBe(3)

			stack.pop()
			expect(stack.size).toBe(2)

			stack.push(entry("t4"))
			expect(stack.size).toBe(3)
		})
	})

	// ── findById ──────────────────────────────────────────────────────

	describe("findById", () => {
		beforeEach(() => {
			stack.push(entry("t1"))
			stack.push(entry("t2", "t1"))
			stack.push(entry("t3", "t2"))
		})

		it("returns the matching entry when it exists", () => {
			const found = stack.findById("t2")
			expect(found).toBeDefined()
			expect(found?.taskId).toBe("t2")
			expect(found?.parentTaskId).toBe("t1")
		})

		it("returns undefined when no entry matches", () => {
			expect(stack.findById("nonexistent")).toBeUndefined()
		})

		it("finds the bottom (root) entry", () => {
			const root = stack.findById("t1")
			expect(root?.taskId).toBe("t1")
			expect(root?.parentTaskId).toBeUndefined()
		})

		it("finds the top entry", () => {
			expect(stack.findById("t3")?.taskId).toBe("t3")
		})
	})

	// ── ancestryIds ───────────────────────────────────────────────────

	describe("ancestryIds", () => {
		it("returns IDs from bottom (root) to top (current)", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2", "t1"))
			stack.push(entry("t3", "t2"))

			expect(stack.ancestryIds()).toEqual(["t1", "t2", "t3"])
		})

		it("reflects pushes and pops", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))
			expect(stack.ancestryIds()).toEqual(["t1", "t2"])

			stack.pop()
			expect(stack.ancestryIds()).toEqual(["t1"])

			stack.push(entry("t3"))
			expect(stack.ancestryIds()).toEqual(["t1", "t3"])
		})
	})

	// ── clear ─────────────────────────────────────────────────────────

	describe("clear", () => {
		it("makes size 0 and empties the stack", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))
			stack.push(entry("t3"))
			expect(stack.size).toBe(3)

			stack.clear()

			expect(stack.size).toBe(0)
			expect(stack.current).toBeUndefined()
			expect(stack.peek()).toBeUndefined()
			expect(stack.pop()).toBeUndefined()
			expect(stack.ancestryIds()).toEqual([])
			expect(stack.toArray()).toEqual([])
		})

		it("allows reuse after clearing", () => {
			stack.push(entry("t1"))
			stack.clear()
			stack.push(entry("t2"))
			expect(stack.size).toBe(1)
			expect(stack.current?.taskId).toBe("t2")
		})
	})

	// ── toArray ───────────────────────────────────────────────────────

	describe("toArray", () => {
		it("returns entries in push order (bottom to top)", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))

			const arr = stack.toArray()
			expect(arr.map((e) => e.taskId)).toEqual(["t1", "t2"])
		})

		it("returns a copy – mutating it does not affect the stack", () => {
			stack.push(entry("t1"))
			stack.push(entry("t2"))

			const arr = stack.toArray() as TaskStackEntry[]
			arr.pop()
			arr.push(entry("t99"))

			// Stack is untouched.
			expect(stack.size).toBe(2)
			expect(stack.ancestryIds()).toEqual(["t1", "t2"])
		})
	})
})
