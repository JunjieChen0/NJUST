import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import * as path from "path"
import * as os from "os"

import { AuditLogger, type AuditEntry } from "../AuditLogger"
import { logger as sharedLogger } from "../../shared/logger"

describe("AuditLogger", () => {
	let tmpDir: string
	let logger: AuditLogger

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"))
		logger = new AuditLogger(tmpDir)
	})

	afterEach(async () => {
		await logger.dispose()
		// Windows: WriteStream.end() 回调可能在文件句柄完全释放前返回，
		// 导致 fs.rmSync 抛出 ENOTEMPTY。重试最多 3 次，间隔 100ms。
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true })
				break
			} catch {
				// [intentional] Windows file lock release wait
				if (attempt < 2) await new Promise((r) => setTimeout(r, 100))
			}
		}
	})

	function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
		return {
			timestamp: "2026-06-03T12:00:00.000Z",
			category: "tool.execution",
			action: "tool.read_file",
			outcome: "success",
			...overrides,
		}
	}

	it("writes NDJSON entries to date-stamped file", async () => {
		logger.log(makeEntry({ action: "tool.read_file" }))
		logger.log(makeEntry({ action: "tool.write_to_file" }))

		await logger.flush()

		const auditDir = path.join(tmpDir, "audit")
		const files = fs.readdirSync(auditDir)
		expect(files).toHaveLength(1)
		expect(files[0]).toMatch(/^events-\d{8}\.ndjson$/)

		const content = fs.readFileSync(path.join(auditDir, files[0]), "utf-8")
		const lines = content.trim().split("\n")
		expect(lines).toHaveLength(2)

		const entry1 = JSON.parse(lines[0])
		expect(entry1.action).toBe("tool.read_file")
		const entry2 = JSON.parse(lines[1])
		expect(entry2.action).toBe("tool.write_to_file")
	})

	it("appends to existing file on same day", async () => {
		logger.log(makeEntry())
		await logger.flush()

		// Create a new logger instance for same dir (simulates restart)
		const logger2 = new AuditLogger(tmpDir)
		logger2.log(makeEntry({ action: "tool.execute_command" }))
		await logger2.flush()
		await logger2.dispose()

		const auditDir = path.join(tmpDir, "audit")
		const files = fs.readdirSync(auditDir)
		expect(files).toHaveLength(1)

		const content = fs.readFileSync(path.join(auditDir, files[0]), "utf-8")
		expect(content.trim().split("\n")).toHaveLength(2)
	})

	it("drops entries silently after dispose", async () => {
		await logger.dispose()
		// Should not throw
		logger.log(makeEntry())
	})

	it("creates audit subdirectory automatically", async () => {
		logger.log(makeEntry())
		await logger.flush()

		expect(fs.existsSync(path.join(tmpDir, "audit"))).toBe(true)
	})

	it("includes all required fields in serialized entry", async () => {
		const entry = makeEntry({
			taskId: "task-123",
			tool: "read_file",
			meta: { toolUseId: "use-456", inputSummary: '{"path":"/foo"}' },
		})
		logger.log(entry)
		await logger.flush()

		const auditDir = path.join(tmpDir, "audit")
		const files = fs.readdirSync(auditDir)
		const content = fs.readFileSync(path.join(auditDir, files[0]), "utf-8")
		const parsed = JSON.parse(content.trim())

		expect(parsed).toEqual({
			timestamp: "2026-06-03T12:00:00.000Z",
			category: "tool.execution",
			action: "tool.read_file",
			outcome: "success",
			taskId: "task-123",
			tool: "read_file",
			meta: { toolUseId: "use-456", inputSummary: '{"path":"/foo"}' },
		})
	})

	it("emits a single warn when the daily entry cap is reached", async () => {
		const warnSpy = vi.spyOn(sharedLogger, "warn").mockImplementation(() => {})
		try {
			// Seed the rotation by writing one normal entry so currentDate is set;
			// further log() calls won't rotate again on the same day.
			logger.log(makeEntry({ action: "tool.first" }))

			// Force the per-file cap via the internal counter; this is the only
			// way to exercise the cap path without writing 50k real entries.
			;(logger as unknown as { entryCount: number }).entryCount = 50_000

			logger.log(makeEntry({ action: "tool.dropped.1" }))
			logger.log(makeEntry({ action: "tool.dropped.2" }))
			logger.log(makeEntry({ action: "tool.dropped.3" }))

			// First over-cap log emits the warn; subsequent over-cap logs do not.
			const matchingCalls = warnSpy.mock.calls.filter(
				(c) => c[0] === "AuditLogger" && /Daily entry cap/.test(String(c[1])),
			)
			expect(matchingCalls).toHaveLength(1)
		} finally {
			warnSpy.mockRestore()
		}
	})
})
