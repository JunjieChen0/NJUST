import { describe, it, expect } from "vitest"
import { formatCostBreakdown, getCostBreakdownIfNeeded } from "../costFormatting"

describe("costFormatting", () => {
	const labels = { own: "Own", subtasks: "Subtasks" }

	describe("formatCostBreakdown", () => {
		it("formats cost breakdown string correctly", () => {
			const result = formatCostBreakdown(1.235, 4.561, labels)
			expect(result).toBe("Own: $1.24 + Subtasks: $4.56")
		})

		it("handles zero costs", () => {
			const result = formatCostBreakdown(0, 0, labels)
			expect(result).toBe("Own: $0.00 + Subtasks: $0.00")
		})
	})

	describe("getCostBreakdownIfNeeded", () => {
		it("returns undefined if costs is undefined", () => {
			const result = getCostBreakdownIfNeeded(undefined, labels)
			expect(result).toBeUndefined()
		})

		it("returns undefined if childrenCost is 0 or less", () => {
			const result1 = getCostBreakdownIfNeeded({ ownCost: 1.0, childrenCost: 0 }, labels)
			expect(result1).toBeUndefined()

			const result2 = getCostBreakdownIfNeeded({ ownCost: 1.0, childrenCost: -0.5 }, labels)
			expect(result2).toBeUndefined()
		})

		it("returns formatted cost breakdown if childrenCost is greater than 0", () => {
			const result = getCostBreakdownIfNeeded({ ownCost: 1.23, childrenCost: 0.45 }, labels)
			expect(result).toBe("Own: $1.23 + Subtasks: $0.45")
		})
	})
})
