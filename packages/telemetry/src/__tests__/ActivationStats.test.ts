import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { readActivationRecords, computePercentiles } from "../ActivationStats.js"

describe("ActivationStats", () => {
	const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-test-"))

	const writeNdjson = (dir: string, filename: string, lines: string[]) => {
		fs.writeFileSync(path.join(dir, filename), lines.join("\n"), "utf-8")
	}

	describe("readActivationRecords", () => {
		it("returns empty array for non-existent directory", () => {
			expect(readActivationRecords("/non/existent/path")).toEqual([])
		})

		it("reads activation events from ndjson files", () => {
			const dir = createTempDir()
			try {
				const now = Date.now()
				const entry = { t: now, n: "extension_activated", p: { activationMs: 150, coldStart: true } }
				writeNdjson(dir, "events-2026-07.ndjson", [JSON.stringify(entry)])

				const records = readActivationRecords(dir, 30)
				expect(records).toHaveLength(1)
				expect(records[0]!.activationMs).toBe(150)
				expect(records[0]!.coldStart).toBe(true)
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		})

		it("filters out non-activation events", () => {
			const dir = createTempDir()
			try {
				const now = Date.now()
				const lines = [
					JSON.stringify({ t: now, n: "extension_activated", p: { activationMs: 100, coldStart: false } }),
					JSON.stringify({ t: now, n: "task_completed", p: { taskId: "abc" } }),
					JSON.stringify({ t: now, n: "extension_activated", p: { activationMs: 200, coldStart: true } }),
				]
				writeNdjson(dir, "events-2026-07.ndjson", lines)

				const records = readActivationRecords(dir, 30)
				expect(records).toHaveLength(2)
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		})

		it("skips entries outside the time window", () => {
			const dir = createTempDir()
			try {
				const old = Date.now() - 60 * 24 * 60 * 60 * 1000 // 60 days ago
				const recent = Date.now()
				const lines = [
					JSON.stringify({ t: old, n: "extension_activated", p: { activationMs: 999, coldStart: false } }),
					JSON.stringify({ t: recent, n: "extension_activated", p: { activationMs: 100, coldStart: false } }),
				]
				writeNdjson(dir, "events-2026-07.ndjson", lines)

				const records = readActivationRecords(dir, 30)
				expect(records).toHaveLength(1)
				expect(records[0]!.activationMs).toBe(100)
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		})

		it("skips entries with invalid activationMs", () => {
			const dir = createTempDir()
			try {
				const now = Date.now()
				const lines = [
					JSON.stringify({ t: now, n: "extension_activated", p: { activationMs: -5, coldStart: false } }),
					JSON.stringify({ t: now, n: "extension_activated", p: { activationMs: "bad", coldStart: false } }),
					JSON.stringify({ t: now, n: "extension_activated", p: { activationMs: 50, coldStart: false } }),
				]
				writeNdjson(dir, "events-2026-07.ndjson", lines)

				const records = readActivationRecords(dir, 30)
				expect(records).toHaveLength(1)
				expect(records[0]!.activationMs).toBe(50)
			} finally {
				fs.rmSync(dir, { recursive: true, force: true })
			}
		})
	})

	describe("computePercentiles", () => {
		it("returns zero stats for empty records", () => {
			const report = computePercentiles([])
			expect(report.sampleCount).toBe(0)
			expect(report.all.p50).toBe(0)
			expect(report.all.count).toBe(0)
		})

		it("computes correct percentiles for a known dataset", () => {
			const records = Array.from({ length: 100 }, (_, i) => ({
				timestamp: Date.now() + i,
				activationMs: (i + 1) * 10, // 10, 20, ..., 1000
				coldStart: i < 30, // first 30 are cold
			}))

			const report = computePercentiles(records)
			expect(report.sampleCount).toBe(100)
			expect(report.all.count).toBe(100)
			expect(report.all.max).toBe(1000)
			expect(report.cold.count).toBe(30)
			expect(report.warm.count).toBe(70)
			expect(report.all.p50).toBeGreaterThan(0)
			expect(report.all.p95).toBeGreaterThan(report.all.p50)
			expect(report.all.p99).toBeGreaterThan(report.all.p95)
		})

		it("handles single record", () => {
			const records = [{ timestamp: Date.now(), activationMs: 42, coldStart: true }]
			const report = computePercentiles(records)
			expect(report.sampleCount).toBe(1)
			expect(report.all.p50).toBe(42)
			expect(report.cold.count).toBe(1)
			expect(report.warm.count).toBe(0)
		})
	})
})
