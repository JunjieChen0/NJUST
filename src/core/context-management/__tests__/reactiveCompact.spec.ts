import { describe, expect, it } from "vitest"

import { reactiveCompactMessages } from "../reactiveCompact"
import type { ApiMessage } from "../../task-persistence/apiMessages"

function mkUser(content: string): ApiMessage {
	return { role: "user", content, ts: Date.now() }
}

describe("reactiveCompactMessages", () => {
	it("keeps first message and shrinks long history", () => {
		const msgs: ApiMessage[] = [mkUser("seed")]
		for (let i = 0; i < 30; i++) msgs.push(mkUser(`m-${i} ${"x".repeat(1200)}`))
		const compacted = reactiveCompactMessages(msgs, 95)
		expect(compacted.length).toBeLessThan(msgs.length)
		expect(compacted[0]?.content).toBe("seed")
	})
})
