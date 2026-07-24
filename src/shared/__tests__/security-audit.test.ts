import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

import {
	logSecurityEvent,
	addSecurityAuditSink,
	clearSecurityAuditSinks,
	type SecurityAuditEvent,
} from "../security-audit"
import { logger } from "../logger"

describe("security-audit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		clearSecurityAuditSinks()
	})

	afterEach(() => {
		clearSecurityAuditSinks()
	})

	describe("logSecurityEvent", () => {
		it("auto-generates timestamp and requestId", () => {
			logSecurityEvent({
				action: "test.action",
				result: "allowed",
			})

			expect(logger.info).toHaveBeenCalledTimes(1)
			const logged = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]!
			const parsed = JSON.parse(logged[1]!)
			expect(parsed.action).toBe("test.action")
			expect(parsed.result).toBe("allowed")
			expect(parsed.ts).toBeTypeOf("number")
			expect(parsed.rid).toBeTypeOf("string")
			expect(parsed.rid.length).toBeGreaterThan(0)
		})

		it("uses provided timestamp and requestId", () => {
			logSecurityEvent({
				action: "test.action",
				result: "denied",
				timestamp: 12345,
				requestId: "req-abc",
			})

			const parsed = JSON.parse((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]![1]!)
			expect(parsed.ts).toBe(12345)
			expect(parsed.rid).toBe("req-abc")
		})

		it("logs allowed result at info level", () => {
			logSecurityEvent({
				action: "test.action",
				result: "allowed",
			})
			expect(logger.info).toHaveBeenCalledTimes(1)
			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("logs denied result at warn level", () => {
			logSecurityEvent({
				action: "test.action",
				result: "denied",
			})
			expect(logger.warn).toHaveBeenCalledTimes(1)
			expect(logger.info).not.toHaveBeenCalled()
		})

		it("logs failed result at warn level", () => {
			logSecurityEvent({
				action: "test.action",
				result: "failed",
			})
			expect(logger.warn).toHaveBeenCalledTimes(1)
		})

		it("passes event to registered sinks", () => {
			const sink = vi.fn()
			addSecurityAuditSink(sink)

			logSecurityEvent({
				action: "test.action",
				result: "allowed",
			})

			expect(sink).toHaveBeenCalledTimes(1)
			const event: SecurityAuditEvent = sink.mock.calls[0]![0]!
			expect(event.action).toBe("test.action")
			expect(event.result).toBe("allowed")
			expect(event.requestId).toBeTypeOf("string")
			expect(event.timestamp).toBeTypeOf("number")
		})

		it("sink errors are caught and do not propagate", () => {
			const badSink = vi.fn(() => {
				throw new Error("sink failure")
			})
			addSecurityAuditSink(badSink)

			expect(() =>
				logSecurityEvent({
					action: "test.action",
					result: "allowed",
				}),
			).not.toThrow()

			expect(logger.debug).toHaveBeenCalled()
		})

		it("removes sink when unsubscribe function is called", () => {
			const sink = vi.fn()
			const unsubscribe = addSecurityAuditSink(sink)

			logSecurityEvent({ action: "a", result: "allowed" })
			expect(sink).toHaveBeenCalledTimes(1)

			unsubscribe()

			logSecurityEvent({ action: "b", result: "allowed" })
			expect(sink).toHaveBeenCalledTimes(1)
		})

		it("includes all optional fields in log output", () => {
			logSecurityEvent({
				action: "file.delete",
				actorId: "user-123",
				resource: "/path/to/file.cj",
				result: "denied",
				reason: "hash_mismatch",
			})

			const parsed = JSON.parse((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]![1]!)
			expect(parsed.action).toBe("file.delete")
			expect(parsed.actor).toBe("user-123")
			expect(parsed.resource).toBe("/path/to/file.cj")
			expect(parsed.result).toBe("denied")
			expect(parsed.reason).toBe("hash_mismatch")
		})

		it("defaults unknown actor to 'unknown'", () => {
			logSecurityEvent({
				action: "test",
				result: "allowed",
			})

			const parsed = JSON.parse((logger.info as ReturnType<typeof vi.fn>).mock.calls[0]![1]!)
			expect(parsed.actor).toBe("unknown")
		})
	})
})
