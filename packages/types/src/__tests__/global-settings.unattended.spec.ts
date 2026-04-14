import { describe, expect, it } from "vitest"

import { EVALS_SETTINGS, globalSettingsSchema } from "../global-settings.js"

describe("global settings unattended retry fields", () => {
	it("accepts unattended retry settings in schema", () => {
		const parsed = globalSettingsSchema.parse({
			unattendedRetryEnabled: true,
			unattendedMaxRetryAttempts: 7,
			unattendedMaxBackoffSeconds: 420,
		})

		expect(parsed.unattendedRetryEnabled).toBe(true)
		expect(parsed.unattendedMaxRetryAttempts).toBe(7)
		expect(parsed.unattendedMaxBackoffSeconds).toBe(420)
	})

	it("contains eval defaults for unattended retry settings", () => {
		expect(EVALS_SETTINGS.unattendedRetryEnabled).toBe(false)
		expect(EVALS_SETTINGS.unattendedMaxRetryAttempts).toBe(5)
		expect(EVALS_SETTINGS.unattendedMaxBackoffSeconds).toBe(300)
	})

	it("enables turn-aware prompt pruning by default in eval settings", () => {
		expect(EVALS_SETTINGS.enableTurnAwarePromptPruning).toBe(true)
	})
})
