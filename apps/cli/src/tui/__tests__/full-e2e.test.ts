/**
 * IPC Protocol E2E Test
 *
 * Validates the IPC serialization/parsing cycle used by the OpenTUI subprocess.
 */

import { describe, it, expect } from "vitest"
import { execSync } from "child_process"
import { IpcProtocol } from "../runtime/ipc-protocol.ts"

function isBunAvailable(): boolean {
	try {
		execSync("bun --version", { stdio: "pipe" })
		return true
	} catch {
		return false
	}
}

describe.skipIf(!isBunAvailable())("IPC Protocol E2E", () => {
	it("IPC protocol can serialize full command sequence", () => {
		// Simulate a full session lifecycle via IPC
		const messages = [
			IpcProtocol.createRequest("init", { workspace: "/test" }),
			IpcProtocol.createEvent("ready", { ok: true }),
			IpcProtocol.createRequest("startTask", { prompt: "Hello", sessionId: "s1" }),
			IpcProtocol.createEvent("message", {
				type: "message.created",
				messageId: "m1",
				role: "user",
				content: "Hello",
			}),
			IpcProtocol.createEvent("message", { type: "text.delta", messageId: "m2", delta: "Hi" }),
			IpcProtocol.createEvent("message", { type: "text.completed", messageId: "m2", text: "Hi there!" }),
			IpcProtocol.createEvent("message", { type: "task.completed", success: true }),
			IpcProtocol.createRequest("dispose"),
			IpcProtocol.createEvent("exit", { code: 0 }),
		]

		// All messages should serialize correctly
		for (const msg of messages) {
			const serialized = IpcProtocol.serialize(msg)
			expect(serialized).toContain("\n")
			expect(() => JSON.parse(serialized.trim())).not.toThrow()
		}

		// All messages should round-trip through parse
		const allSerialized = messages.map((m) => IpcProtocol.serialize(m)).join("")
		const allParsed = IpcProtocol.parse(allSerialized)
		expect(allParsed).toHaveLength(messages.length)

		// Verify types
		expect(allParsed[0].type).toBe("request")
		expect(allParsed[1].type).toBe("event")
		expect(allParsed[1]).toMatchObject({ event: "ready" })
		expect(allParsed[2].type).toBe("request")
		expect(allParsed[2]).toMatchObject({ method: "startTask" })
		expect(allParsed[8].type).toBe("event")
		expect(allParsed[8]).toMatchObject({ event: "exit" })
	})
})
