import { describe, it, expect, beforeEach } from "vitest"

import { useDialogStore } from "../DialogProvider.js"

describe("DialogProvider stack", () => {
	beforeEach(() => {
		useDialogStore.setState({ stack: [], nextId: 1 })
	})

	it("starts empty", () => {
		expect(useDialogStore.getState().stack).toEqual([])
	})

	it("push appends entries with monotonic ids", () => {
		const { push } = useDialogStore.getState()
		const a = push({ render: () => null, size: "medium" })
		const b = push({ render: () => null, size: "medium" })
		expect(a).toBe(1)
		expect(b).toBe(2)
		expect(useDialogStore.getState().stack.map((e) => e.id)).toEqual([1, 2])
	})

	it("replace closes existing entries and starts fresh", () => {
		const { push, replace } = useDialogStore.getState()
		const closed: number[] = []
		push({ render: () => null, size: "medium", onClose: () => closed.push(1) })
		push({ render: () => null, size: "medium", onClose: () => closed.push(2) })
		const id = replace({ render: () => null, size: "large" })
		expect(closed).toEqual([1, 2])
		expect(useDialogStore.getState().stack).toHaveLength(1)
		expect(useDialogStore.getState().stack[0]!.id).toBe(id)
		expect(useDialogStore.getState().stack[0]!.size).toBe("large")
	})

	it("pop removes the top and fires onClose", () => {
		const { push, pop } = useDialogStore.getState()
		const closed: number[] = []
		push({ render: () => null, size: "medium", onClose: () => closed.push(1) })
		push({ render: () => null, size: "medium", onClose: () => closed.push(2) })
		pop()
		expect(closed).toEqual([2])
		expect(useDialogStore.getState().stack).toHaveLength(1)
	})

	it("pop on empty stack is a no-op", () => {
		const { pop } = useDialogStore.getState()
		pop()
		expect(useDialogStore.getState().stack).toEqual([])
	})

	it("popById removes a specific entry from anywhere in the stack", () => {
		const { push, popById } = useDialogStore.getState()
		const closed: number[] = []
		const a = push({ render: () => null, size: "medium", onClose: () => closed.push(1) })
		const b = push({ render: () => null, size: "medium", onClose: () => closed.push(2) })
		popById(a)
		expect(closed).toEqual([1])
		expect(useDialogStore.getState().stack.map((e) => e.id)).toEqual([b])
	})

	it("clear empties the stack and fires every onClose", () => {
		const { push, clear } = useDialogStore.getState()
		const closed: number[] = []
		push({ render: () => null, size: "medium", onClose: () => closed.push(1) })
		push({ render: () => null, size: "medium", onClose: () => closed.push(2) })
		clear()
		expect(closed).toEqual([1, 2])
		expect(useDialogStore.getState().stack).toEqual([])
	})

	it("nextId is preserved across replace and clear", () => {
		const { push, replace, clear } = useDialogStore.getState()
		push({ render: () => null, size: "medium" })
		push({ render: () => null, size: "medium" })
		expect(useDialogStore.getState().nextId).toBe(3)
		replace({ render: () => null, size: "medium" })
		expect(useDialogStore.getState().nextId).toBe(4)
		clear()
		expect(useDialogStore.getState().nextId).toBe(4)
		const id = useDialogStore.getState().push({ render: () => null, size: "medium" })
		expect(id).toBe(4)
	})
})
