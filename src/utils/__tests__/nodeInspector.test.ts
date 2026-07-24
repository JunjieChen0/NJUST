import { describe, expect, it } from "vitest"

import { isKnownNodeInspectorProtocolError } from "../nodeInspector"

describe("isKnownNodeInspectorProtocolError", () => {
	it("matches the Node inspector dataLength protocol error", () => {
		const error = new TypeError("Missing dataLength in event")
		error.stack =
			"TypeError: Missing dataLength in event\n" +
			"    at broadcastToFrontend (node:inspector:212:3)\n" +
			"    at Object.dataReceived (node:inspector:221:29)"

		expect(isKnownNodeInspectorProtocolError(error)).toBe(true)
	})

	it("does not match the same message from application code", () => {
		const error = new Error("Missing dataLength in event")
		error.stack = "Error: Missing dataLength in event\n    at parseResponse (src/network.ts:10:2)"

		expect(isKnownNodeInspectorProtocolError(error)).toBe(false)
	})

	it("does not match other inspector errors", () => {
		const error = new Error("Connection closed")
		error.stack = "Error: Connection closed\n    at dataReceived (node:inspector:221:29)"

		expect(isKnownNodeInspectorProtocolError(error)).toBe(false)
	})

	it("does not match a partial inspector stack", () => {
		const error = new Error("Missing dataLength in event")
		error.stack =
			"Error: Missing dataLength in event\n" +
			"    at broadcastToFrontend (node:inspector:212:3)\n" +
			"    at unrelatedHandler (node:inspector:221:29)"

		expect(isKnownNodeInspectorProtocolError(error)).toBe(false)
	})

	it("rejects non-error values", () => {
		expect(isKnownNodeInspectorProtocolError({ message: "Missing dataLength in event" })).toBe(false)
		expect(isKnownNodeInspectorProtocolError(undefined)).toBe(false)
	})
})
