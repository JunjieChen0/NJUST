import { render } from "ink-testing-library"
import { describe, it, expect, vi } from "vitest"

import { DialogSelect, type DialogSelectOption } from "../DialogSelect.js"

interface FruitValue {
	id: string
}

const FRUITS: DialogSelectOption<FruitValue>[] = [
	{ title: "Apple", value: { id: "apple" } },
	{ title: "Banana", value: { id: "banana" } },
	{ title: "Cherry", value: { id: "cherry" } },
	{ title: "Date", value: { id: "date" } },
	{ title: "Elderberry", value: { id: "elderberry" }, disabled: true },
]

describe("DialogSelect", () => {
	it("renders the title and all enabled options", () => {
		const { lastFrame } = render(
			<DialogSelect title="Pick a fruit" options={FRUITS} onSelect={() => {}} filterable={false} />,
		)
		const frame = lastFrame() ?? ""
		expect(frame).toContain("Pick a fruit")
		expect(frame).toContain("Apple")
		expect(frame).toContain("Banana")
		expect(frame).toContain("Cherry")
		expect(frame).toContain("Date")
		// Disabled option is filtered out.
		expect(frame).not.toContain("Elderberry")
	})

	it("highlights the first option by default with the selection marker", () => {
		const { lastFrame } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={() => {}} filterable={false} />,
		)
		expect(lastFrame() ?? "").toContain("▶ Apple")
	})

	it("respects initialIndex", () => {
		const { lastFrame } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={() => {}} filterable={false} initialIndex={2} />,
		)
		expect(lastFrame() ?? "").toContain("▶ Cherry")
	})

	it("calls onSelect with the highlighted option's value when Enter is pressed", () => {
		const onSelect = vi.fn()
		const { stdin } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={onSelect} filterable={false} initialIndex={1} />,
		)
		stdin.write("\r")
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith({ id: "banana" }, expect.objectContaining({ title: "Banana" }))
	})

	it("calls onCancel when Esc is pressed", () => {
		const onCancel = vi.fn()
		const { stdin } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={() => {}} onCancel={onCancel} filterable={false} />,
		)
		stdin.write("\u001b") // ESC
		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	it("filters with fuzzysort when filterable is on", async () => {
		const { stdin, lastFrame } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={() => {}} filterable={true} />,
		)
		// ink-testing-library delivers each write as a separate input event, so
		// type characters one at a time and yield to the event loop between
		// writes to give Ink a chance to flush.
		for (const ch of "apl") {
			stdin.write(ch)
			await new Promise((resolve) => setImmediate(resolve))
		}
		const frame = lastFrame() ?? ""
		expect(frame).toContain("Apple")
		// Cherry / Banana should NOT be visible because the filter is "apl".
		expect(frame).not.toContain("Cherry")
		expect(frame).not.toContain("Banana")
	})

	it("renders 'No results' when the filter excludes everything", async () => {
		const { stdin, lastFrame } = render(
			<DialogSelect title="Pick" options={FRUITS} onSelect={() => {}} filterable={true} />,
		)
		for (const ch of "xyzzz") {
			stdin.write(ch)
			await new Promise((resolve) => setImmediate(resolve))
		}
		expect(lastFrame() ?? "").toContain("No results")
	})
})
