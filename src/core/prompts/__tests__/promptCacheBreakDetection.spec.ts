import { describe, expect, it } from "vitest"

import { PromptCacheBreakDetector } from "../promptCacheBreakDetection"

describe("prompt cache break detection", () => {
	it("detects dynamic-only changes", () => {
		const detector = new PromptCacheBreakDetector()
		expect(detector.check("static-a", "dynamic-a")).toBeNull()

		const event = detector.check("static-a", "dynamic-b")
		expect(event).not.toBeNull()
		expect(event!.staticPartChanged).toBe(false)
		expect(event!.dynamicPartChanged).toBe(true)
		expect(event!.changeSource).toBe("environment_info_changed")
	})

	it("detects static-only changes", () => {
		const detector = new PromptCacheBreakDetector()
		expect(detector.check("static-a", "dynamic-a")).toBeNull()

		const event = detector.check("static-b", "dynamic-a")
		expect(event).not.toBeNull()
		expect(event!.staticPartChanged).toBe(true)
		expect(event!.dynamicPartChanged).toBe(false)
		expect(event!.changeSource).toBe("tools_list_changed")
	})

	it("does not report break for normalized timestamp-only changes", () => {
		const detector = new PromptCacheBreakDetector()
		expect(detector.check("system generated at 2026-04-13T11:11:11Z", "dynamic-a")).toBeNull()

		const event = detector.check("system generated at 2026-04-14T12:12:12Z", "dynamic-a")
		expect(event).toBeNull()
	})

	it("does not emit cache break when only tool payloads change but static+dynamic full hash is unchanged", () => {
		const detector = new PromptCacheBreakDetector()
		expect(
			detector.check("static-a", "dynamic-a", {
				toolDescriptions: "tool-desc-v1",
				capabilitiesSection: "cap-v1",
			}),
		).toBeNull()

		// Tool-hash-only deltas are not surfaced as cache breaks if the combined
		// static+dynamic prompt text hashes remain identical (early exit on fullHash).
		const event = detector.check("static-a", "dynamic-a", {
			toolDescriptions: "tool-desc-v2",
			capabilitiesSection: "cap-v1",
		})
		expect(event).toBeNull()
	})
})
