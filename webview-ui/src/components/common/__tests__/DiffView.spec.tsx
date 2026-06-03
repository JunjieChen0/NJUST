import { render, screen, act } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import DiffView from "../DiffView"

// Mock the async highlightHunks function
vi.mock("@src/utils/highlightDiff", () => ({
	highlightHunks: vi.fn().mockImplementation(async (oldText: string, newText: string) => {
		return {
			oldLines: oldText.split("\n").map((line: string) => `highlighted: ${line}`),
			newLines: newText.split("\n").map((line: string) => `highlighted: ${line}`),
		}
	}),
}))

describe("DiffView", () => {
	const mockDiff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-old line 1
+new line 1
 context line
-old line 2
+new line 2`

	it("renders unhighlighted diff initially", async () => {
		const { container } = render(<DiffView source={mockDiff} filePath="foo.ts" />)

		// Check basic diff structure is rendered
		expect(screen.getByText("old line 1")).toBeInTheDocument()
		expect(screen.getByText("new line 1")).toBeInTheDocument()
		expect(screen.getByText("context line")).toBeInTheDocument()

		// Verify line numbers are displayed correctly
		const deletions = container.querySelectorAll(".diff-content-removed")
		const additions = container.querySelectorAll(".diff-content-inserted")
		expect(deletions).toHaveLength(2)
		expect(additions).toHaveLength(2)
	})

	it("applies highlight when shouldHighlight is true", async () => {
		await act(async () => {
			render(<DiffView source={mockDiff} filePath="foo.ts" />)
		})

		// After highlight effect completes, we should see highlighted content
		// We expect "highlighted: " prefix from our mock implementation
		expect(screen.getByText("highlighted: old line 1")).toBeInTheDocument()
		expect(screen.getByText("highlighted: new line 1")).toBeInTheDocument()
	})

	it("disables highlight for large diffs", async () => {
		// Generate a large diff with over 1000 lines to trigger shouldHighlight = false
		const manyLines = Array.from({ length: 1010 }, (_, i) => ` line ${i}`).join("\n")
		const largeDiff = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
@@ -1,1010 +1,1010 @@
${manyLines}`

		render(<DiffView source={largeDiff} filePath="large.ts" />)

		// It should render text without highlighted prefix because highlighting is bypassed
		expect(screen.getByText("line 500")).toBeInTheDocument()
		expect(screen.queryByText("highlighted: line 500")).not.toBeInTheDocument()
	})

	it("renders gap separator correctly for multi-hunk diffs", () => {
		const multiHunkDiff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old 1
+new 1
 context 2
@@ -10,2 +10,2 @@
-old 10
+new 10
 context 11`

		render(<DiffView source={multiHunkDiff} filePath="foo.ts" />)

		expect(screen.getByText("7 hidden lines")).toBeInTheDocument()
	})
})
