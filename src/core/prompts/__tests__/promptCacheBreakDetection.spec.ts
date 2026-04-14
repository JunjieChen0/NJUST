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

	it("detects per-tool hash changes and reports changed tools", () => {
		const detector = new PromptCacheBreakDetector()
		expect(
			detector.check("static-a", "dynamic-a", {
				toolDescriptions: "tool-desc-v1",
				capabilitiesSection: "cap-v1",
			}),
		).toBeNull()

		const event = detector.check("static-a", "dynamic-a", {
			toolDescriptions: "tool-desc-v2",
			capabilitiesSection: "cap-v1",
		})
		expect(event).not.toBeNull()
		expect(event!.changeSource).toBe("mcp_tools_changed")
		expect(event!.changedTools).toEqual(["toolDescriptions"])
		expect(event!.previousToolHashes).toBeDefined()
		expect(event!.currentToolHashes).toBeDefined()
		expect(event!.previousToolHashes?.toolDescriptions).toBeTruthy()
		expect(event!.currentToolHashes?.toolDescriptions).toBeTruthy()
		expect(event!.previousToolHashes?.toolDescriptions).not.toEqual(event!.currentToolHashes?.toolDescriptions)
		expect(event!.previousToolHashes?.capabilitiesSection).toEqual(event!.currentToolHashes?.capabilitiesSection)
	})
})
