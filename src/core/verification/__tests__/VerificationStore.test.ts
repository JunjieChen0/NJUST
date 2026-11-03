import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { VerificationRun } from "../types"
import {
	VERIFICATION_FILE_NAME,
	VerificationRecordCorruptError,
	createEmptyVerificationRecord,
	loadVerificationRecord,
	updateVerificationRecord,
	withAcceptance,
	withClaim,
	withRun,
	withInvalidation,
} from "../VerificationStore"

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	}),
}))

function buildRun(overrides: Partial<VerificationRun> = {}): VerificationRun {
	return {
		runId: "run-1",
		taskId: "task-1",
		kind: "build",
		executable: "cjpm",
		args: ["build"],
		cwd: "/ws/app",
		startedAt: 1_000,
		status: "running",
		stale: false,
		...overrides,
	}
}

describe("verification record helpers", () => {
	it("deduplicates invalidations while retaining distinct environment changes and caps file details", () => {
		const inv = {
			at: 1,
			cause: "checkpoint_restore" as const,
			toFingerprint: "fp",
			changes: [],
			changesTruncated: false,
		}
		const first = withInvalidation(createEmptyVerificationRecord("task-1"), inv)
		expect(withInvalidation(first, { ...inv, at: 2, cause: "task_resume" })).toBe(first)
		const changed = withInvalidation(first, {
			...inv,
			cause: "environment_change",
			environment: { sdkVersion: "2" },
		})
		expect(changed.invalidations).toHaveLength(2)
		const many = withInvalidation(changed, {
			...inv,
			toFingerprint: "next",
			changes: Array.from({ length: 201 }, (_, i) => ({ path: `${i}.cj`, change: "added", source: "other" })),
		})
		expect(many.invalidations.at(-1)?.changes).toHaveLength(200)
		expect(many.invalidations.at(-1)?.changesTruncated).toBe(true)
	})
	it("appends a new run and replaces a run with the same id without mutating the input", () => {
		const empty = createEmptyVerificationRecord("task-1")
		const started = withRun(empty, buildRun())
		const finished = withRun(started, buildRun({ status: "passed", exitCode: 0, endedAt: 2_000 }))

		expect(empty.runs).toHaveLength(0)
		expect(started.runs).toEqual([buildRun()])
		expect(finished.runs).toHaveLength(1)
		expect(finished.runs[0].status).toBe("passed")
	})

	it("ignores a duplicate completion claim", () => {
		const claim = { claimId: "c1", taskId: "task-1", claimedAt: 5_000 }
		const once = withClaim(createEmptyVerificationRecord("task-1"), claim)
		const twice = withClaim(once, { ...claim, claimedAt: 9_000 })

		expect(twice).toBe(once)
		expect(twice.claims).toEqual([claim])
	})

	it("ignores a repeated identical decision but keeps a changed one", () => {
		const base = withClaim(createEmptyVerificationRecord("task-1"), {
			claimId: "c1",
			taskId: "task-1",
			claimedAt: 5_000,
		})
		const accepted = withAcceptance(base, { claimId: "c1", decidedAt: 6_000, decision: "accepted" })
		const repeated = withAcceptance(accepted, { claimId: "c1", decidedAt: 6_500, decision: "accepted" })
		const changed = withAcceptance(repeated, { claimId: "c1", decidedAt: 7_000, decision: "changes_requested" })

		expect(repeated).toBe(accepted)
		expect(changed.acceptances.map((a) => a.decision)).toEqual(["accepted", "changes_requested"])
	})

	it("rejects an acceptance for an unknown delivery", () => {
		const base = createEmptyVerificationRecord("task-1")

		expect(() => withAcceptance(base, { claimId: "missing", decidedAt: 1, decision: "accepted" })).toThrow(
			/unknown delivery/i,
		)
	})
})

describe("verification record persistence", () => {
	let taskDir: string

	beforeEach(async () => {
		taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "verification-store-"))
	})

	afterEach(async () => {
		await fs.rm(taskDir, { recursive: true, force: true })
	})

	it("returns undefined when no record exists", async () => {
		await expect(loadVerificationRecord(taskDir, "task-1")).resolves.toBeUndefined()
	})

	it("loads version 1 records without invalidations", async () => {
		await fs.writeFile(
			path.join(taskDir, VERIFICATION_FILE_NAME),
			JSON.stringify({ version: 1, taskId: "task-1", runs: [], claims: [], acceptances: [] }),
		)
		expect((await loadVerificationRecord(taskDir, "task-1"))?.invalidations).toEqual([])
	})

	it("round-trips a record through disk", async () => {
		const saved = await updateVerificationRecord(taskDir, "task-1", (r) => withRun(r, buildRun()))

		await expect(loadVerificationRecord(taskDir, "task-1")).resolves.toEqual(saved)
	})

	it("serializes concurrent updates so no write is lost", async () => {
		await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				updateVerificationRecord(taskDir, "task-1", (r) => withRun(r, buildRun({ runId: `run-${i}` }))),
			),
		)

		const loaded = await loadVerificationRecord(taskDir, "task-1")
		expect(loaded?.runs.map((r) => r.runId).sort()).toEqual(["run-0", "run-1", "run-2", "run-3", "run-4"])
	})

	it("throws instead of silently replacing a corrupt record", async () => {
		const filePath = path.join(taskDir, VERIFICATION_FILE_NAME)
		await fs.writeFile(filePath, "{not json", "utf8")

		await expect(loadVerificationRecord(taskDir, "task-1")).rejects.toBeInstanceOf(VerificationRecordCorruptError)
		await expect(updateVerificationRecord(taskDir, "task-1", (r) => r)).rejects.toBeInstanceOf(
			VerificationRecordCorruptError,
		)
		await expect(fs.readFile(filePath, "utf8")).resolves.toBe("{not json")
	})

	it("rejects a record that fails schema validation", async () => {
		await fs.writeFile(path.join(taskDir, VERIFICATION_FILE_NAME), JSON.stringify({ version: 1 }), "utf8")

		await expect(loadVerificationRecord(taskDir, "task-1")).rejects.toBeInstanceOf(VerificationRecordCorruptError)
	})

	it("rejects a record that belongs to another task", async () => {
		await updateVerificationRecord(taskDir, "task-1", (r) => r)

		await expect(loadVerificationRecord(taskDir, "task-2")).rejects.toBeInstanceOf(VerificationRecordCorruptError)
	})
})
