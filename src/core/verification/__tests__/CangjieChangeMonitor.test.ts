import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { CangjieChangeMonitor, type ChangeMonitorDeps } from "../CangjieChangeMonitor"
import { loadSnapshot, saveSnapshot } from "../snapshotStore"
import { createEmptyVerificationRecord, loadVerificationRecord, updateVerificationRecord } from "../VerificationStore"
import type { VerificationEnvironment, VerificationRun } from "../types"
import type { ProjectSnapshot } from "../projectFingerprint"

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	},
}))

describe("CangjieChangeMonitor", () => {
	let taskDir: string
	let current: ProjectSnapshot
	let environment: VerificationEnvironment
	let monitor: CangjieChangeMonitor
	let deps: ChangeMonitorDeps
	let writtenPaths: string[]
	let inputChanged: (filePath: string) => void
	let environmentChanged: () => void
	let disposeInputs: ReturnType<typeof vi.fn>
	let disposeEnvironment: ReturnType<typeof vi.fn>
	let now: number
	const original = {
		coverage: "complete" as const,
		gaps: [],
		fingerprint: "fp-a",
		files: { "src/a.cj": "a", "src/b.cj": "b" },
	}
	const read = () => loadVerificationRecord(taskDir, "task-1")

	beforeEach(async () => {
		taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "cj-monitor-"))
		current = original
		environment = { sdkVersion: "1", cjpmPath: "cjpm" }
		writtenPaths = []
		now = 10
		disposeInputs = vi.fn()
		disposeEnvironment = vi.fn()
		deps = {
			taskDir: async () => taskDir,
			resolveRoot: async () => ({ kind: "resolved", root: taskDir }),
			snapshot: vi.fn(async () => current),
			environment: async () => environment,
			now: () => ++now,
			watchInputs: (callback) => {
				inputChanged = callback
				return { dispose: disposeInputs }
			},
			watchEnvironment: (callback) => {
				environmentChanged = callback
				return { dispose: disposeEnvironment }
			},
		}
		monitor = new CangjieChangeMonitor({ taskId: "task-1", writtenPaths: () => writtenPaths }, deps)
		await saveSnapshot(taskDir, original)
		const run = (kind: "build" | "test"): VerificationRun => ({
			runId: kind,
			taskId: "task-1",
			kind,
			executable: "cjpm",
			args: [kind],
			cwd: taskDir,
			startedAt: 1,
			endedAt: 2,
			status: "passed",
			exitCode: 0,
			stale: false,
			inputFingerprint: original.fingerprint,
			inputFingerprintAfter: original.fingerprint,
			sdk: { version: "1" },
			testScope: kind === "test" ? { description: "all", executed: 1 } : undefined,
		})
		await updateVerificationRecord(taskDir, "task-1", (record) => ({
			...record,
			runs: [run("build"), run("test")],
		}))
	})

	afterEach(async () => {
		monitor.dispose()
		vi.useRealTimers()
		await fs.rm(taskDir, { recursive: true, force: true })
	})

	it("does not write or emit when inputs have not changed", async () => {
		const before = await fs.readFile(path.join(taskDir, "verification.json"), "utf8")
		const listener = vi.fn()
		monitor.onDidChange(listener)
		expect((await monitor.recheck("file_change"))?.verdict.overall).toBe("verified")
		expect(await fs.readFile(path.join(taskDir, "verification.json"), "utf8")).toBe(before)
		expect(listener).not.toHaveBeenCalled()
	})

	it("does not hash projects with no checks or deliveries", async () => {
		await updateVerificationRecord(taskDir, "task-1", () => createEmptyVerificationRecord("task-1"))
		await expect(monitor.recheck("file_change")).resolves.toBeUndefined()
		expect(deps.snapshot).not.toHaveBeenCalled()
	})

	it("attributes changed files, preserves original runs and saves the new snapshot", async () => {
		writtenPaths = [path.join(taskDir, "src/a.cj")]
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { "src/a.cj": "new", "src/b.cj": "external" },
		}
		const originalRuns = (await read())?.runs
		const listener = vi.fn()
		monitor.onDidChange(listener)
		const result = await monitor.recheck("file_change")
		expect(result?.verdict.build).toMatchObject({ state: "stale", staleReason: "code_changed" })
		expect(result?.changes).toEqual([
			{ path: "src/a.cj", change: "modified", source: "task_tool" },
			{ path: "src/b.cj", change: "modified", source: "other" },
		])
		expect((await read())?.runs).toEqual(originalRuns)
		expect((await read())?.invalidations).toHaveLength(1)
		expect(listener).toHaveBeenCalledOnce()
		const saved = JSON.parse(await fs.readFile(path.join(taskDir, "verification-snapshots/fp-b.json"), "utf8"))
		expect(saved).toEqual(current)
	})

	it("keeps all changes since the last check in the delivery summary across multiple events", async () => {
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { ...original.files, "src/a.cj": "new" },
		}
		await monitor.recheck("file_change")
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-c",
			files: { "src/a.cj": "new", "src/b.cj": "new" },
		}
		await monitor.recheck("file_change")
		const result = await monitor.recheck("task_resume")
		expect(result?.changes.map((change) => change.path)).toEqual(["src/a.cj", "src/b.cj"])
		expect((await read())?.invalidations).toHaveLength(2)
	})

	it("preserves the latest delivery and check snapshots through more than 30 external changes", async () => {
		const delivery = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "delivery",
			files: { ...original.files, "src/a.cj": "delivered" },
		}
		await saveSnapshot(taskDir, delivery)
		await updateVerificationRecord(taskDir, "task-1", (record) => ({
			...record,
			claims: [{ claimId: "delivery-1", taskId: "task-1", claimedAt: 3, inputFingerprint: delivery.fingerprint }],
		}))
		for (const fingerprint of [original.fingerprint, delivery.fingerprint]) {
			await fs.utimes(
				path.join(taskDir, "verification-snapshots", `${fingerprint}.json`),
				new Date(1000),
				new Date(1000),
			)
		}
		for (let i = 0; i < 31; i++) {
			current = {
				coverage: "complete" as const,
				gaps: [],
				fingerprint: `edit-${i}`,
				files: { ...original.files, "src/a.cj": `edit ${i}` },
			}
			await monitor.recheck("file_change")
		}
		await expect(loadSnapshot(taskDir, original.fingerprint)).resolves.toEqual(original)
		await expect(loadSnapshot(taskDir, delivery.fingerprint)).resolves.toEqual(delivery)
		expect(await fs.readdir(path.join(taskDir, "verification-snapshots"))).toHaveLength(30)
		expect((await monitor.recheck("task_resume"))?.changes).toEqual([
			{ path: "src/a.cj", change: "modified", source: "other" },
		])
	})

	it("debounces rapid input changes into one recheck", async () => {
		vi.useFakeTimers()
		monitor.start()
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { ...original.files, "src/a.cj": "new" },
		}
		inputChanged(path.join(taskDir, "src/a.cj"))
		await vi.advanceTimersByTimeAsync(1_500)
		inputChanged(path.join(taskDir, "src/b.cj"))
		inputChanged(path.join(taskDir, "cjpm.toml"))
		await vi.advanceTimersByTimeAsync(1_999)
		expect(deps.snapshot).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		vi.useRealTimers()
		await vi.waitFor(async () => expect((await read())?.invalidations).toHaveLength(1))
		expect(deps.snapshot).toHaveBeenCalledOnce()
	})

	it("ignores generated paths and releases subscriptions and pending work on dispose", async () => {
		vi.useFakeTimers()
		monitor.start()
		for (const dir of [".git", "node_modules", ".njust_ai"]) inputChanged(path.join(taskDir, dir, "a.cj"))
		await vi.advanceTimersByTimeAsync(2_001)
		expect(deps.snapshot).not.toHaveBeenCalled()
		inputChanged(path.join(taskDir, "src/a.cj"))
		monitor.dispose()
		inputChanged(path.join(taskDir, "src/a.cj"))
		await vi.advanceTimersByTimeAsync(2_001)
		expect(deps.snapshot).not.toHaveBeenCalled()
		expect(disposeInputs).toHaveBeenCalledOnce()
		expect(disposeEnvironment).toHaveBeenCalledOnce()
	})

	it("rechecks input directories named target instead of treating all of them as build output", async () => {
		vi.useFakeTimers()
		monitor.start()
		current = { ...original, fingerprint: "nested-target-edit" }
		inputChanged(path.join(taskDir, "test-data", "target", "expected.txt"))
		await vi.advanceTimersByTimeAsync(2_001)
		await vi.waitFor(async () => expect((await read())?.invalidations).toHaveLength(1))
		expect(deps.snapshot).toHaveBeenCalledOnce()
	})

	it("preserves checkpoint cause when task resume rechecks the same code, including after disposal", async () => {
		monitor.dispose()
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { ...original.files, "src/a.cj": "restored" },
		}
		await monitor.recheck("checkpoint_restore")
		const resumed = await monitor.recheck("task_resume")
		expect(resumed?.codeChanged).toBe(true)
		expect((await read())?.invalidations).toMatchObject([{ cause: "checkpoint_restore", toFingerprint: "fp-b" }])
	})

	it("makes previous successful results usable again when code returns to the verified snapshot", async () => {
		const listener = vi.fn()
		monitor.onDidChange(listener)
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { ...original.files, "src/a.cj": "new" },
		}
		await monitor.recheck("file_change")
		current = original
		const result = await monitor.recheck("file_change")
		expect(result?.verdict.overall).toBe("verified")
		expect(result?.changes).toEqual([])
		expect(listener).toHaveBeenCalledTimes(2)
	})

	it("records environment changes with unchanged code and notifies once", async () => {
		vi.useFakeTimers()
		monitor.start()
		const listener = vi.fn()
		monitor.onDidChange(listener)
		environment = { ...environment, sdkVersion: "2" }
		environmentChanged()
		await vi.advanceTimersByTimeAsync(2_000)
		vi.useRealTimers()
		await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
		const result = await monitor.recheck("task_resume")
		expect(result?.verdict.build).toMatchObject({ state: "stale", staleReason: "environment_changed" })
		expect(result?.codeChanged).toBe(false)
		expect((await read())?.invalidations).toMatchObject([
			{ cause: "environment_change", environment: { sdkVersion: "2" } },
		])
		expect(listener).toHaveBeenCalledOnce()
		environment = { ...environment, sdkVersion: "1" }
		expect((await monitor.recheck("environment_change"))?.verdict.overall).toBe("verified")
		expect(listener).toHaveBeenCalledTimes(2)
	})

	it("does not crash or overwrite corrupt records during resume", async () => {
		await fs.writeFile(path.join(taskDir, "verification.json"), "{broken")
		await expect(monitor.recheck("task_resume")).resolves.toBeUndefined()
		expect(await fs.readFile(path.join(taskDir, "verification.json"), "utf8")).toBe("{broken")
	})

	it("serializes concurrent rechecks without duplicate history", async () => {
		current = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-b",
			files: { ...original.files, "src/a.cj": "new" },
		}
		await Promise.all([monitor.recheck("checkpoint_restore"), monitor.recheck("task_resume")])
		expect((await read())?.invalidations).toMatchObject([{ cause: "checkpoint_restore" }])
	})
})
