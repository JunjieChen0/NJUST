import { describe, expect, it } from "vitest"
import { mapErrorToRecoveryAction } from "../recoveryStrategyMap"

describe("recoveryStrategyMap", () => {
	it("maps prompt too long to compact+retry", () => {
		expect(mapErrorToRecoveryAction("prompt_too_long", 0)).toBe("reactive_compact_then_retry")
	})

	it("maps max_output_tokens to continuation retry", () => {
		expect(mapErrorToRecoveryAction("max_output_tokens", 1)).toBe("retry_with_continuation")
	})
})
