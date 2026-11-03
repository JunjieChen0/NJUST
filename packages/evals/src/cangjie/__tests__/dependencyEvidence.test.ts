import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hasPassingDependencyTests, type CangjieTestRunEvidence } from "../evidence.js"

describe("CJ05 dependency test evidence", () => {
	let root: string
	let dependency: string
	let run: CangjieTestRunEvidence
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "cj-eval-dependency-"))
		dependency = path.join(root, "libs/pricing")
		await fs.mkdir(dependency, { recursive: true })
		run = {
			kind: "test",
			phase: "delivery",
			cwd: dependency,
			status: "passed",
			exitCode: 0,
			startedAt: 1,
			inputFingerprint: "delivered",
			inputFingerprintAfter: "delivered",
			inputCoverage: "complete",
			stale: false,
			testScope: { executed: 2, passed: 2, failed: 0 },
		}
	})
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it("requires tests actually executed in the dependency at the delivered code state", async () => {
		await expect(hasPassingDependencyTests([run], dependency, "delivered")).resolves.toBe(true)
	})

	it.each([
		["build only", { kind: "build" }],
		["baseline only", { phase: "baseline" }],
		["unknown exit code", { exitCode: null }],
		["failed exit code", { exitCode: 1 }],
		["failed test", { status: "failed" }],
		["no test counts", { testScope: undefined }],
		["zero tests", { testScope: { executed: 0, passed: 0, failed: 0 } }],
		["failing tests", { testScope: { executed: 2, passed: 1, failed: 1 } }],
		["inconsistent counts", { testScope: { executed: 2, passed: 1, failed: 0 } }],
		["old code", { inputFingerprint: "old", inputFingerprintAfter: "old" }],
		["changed during test", { inputFingerprintAfter: "changed" }],
		["stale", { stale: true }],
		["partial inputs", { inputCoverage: "partial" }],
	] satisfies [string, Partial<CangjieTestRunEvidence>][])("rejects %s", async (_name, override) => {
		await expect(hasPassingDependencyTests([{ ...run, ...override }], dependency, "delivered")).resolves.toBe(false)
	})

	it("rejects root-only tests, missing runs and a missing delivery fingerprint", async () => {
		await expect(hasPassingDependencyTests([{ ...run, cwd: root }], dependency, "delivered")).resolves.toBe(false)
		await expect(hasPassingDependencyTests([], dependency, "delivered")).resolves.toBe(false)
		await expect(hasPassingDependencyTests([run], dependency, undefined)).resolves.toBe(false)
	})

	it("does not reuse an old pass after a newer dependency failure", async () => {
		await expect(
			hasPassingDependencyTests(
				[run, { ...run, startedAt: 2, status: "failed", exitCode: 1 }],
				dependency,
				"delivered",
			),
		).resolves.toBe(false)
	})

	it("matches physical paths through a workspace alias", async () => {
		const alias = path.join(root, "alias")
		await fs.symlink(path.join(root, "libs"), alias, process.platform === "win32" ? "junction" : "dir")
		await expect(hasPassingDependencyTests([run], path.join(alias, "pricing"), "delivered")).resolves.toBe(true)
	})
})
