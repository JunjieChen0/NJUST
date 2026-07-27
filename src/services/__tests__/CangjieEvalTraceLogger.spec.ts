import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
	},
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
	},
}))

import {
	analyzeCangjieEvalTraceText,
	appendCangjieEvalTrace,
	formatCangjieEvalTraceSummaryMarkdown,
	getCangjieEvalTraceNextAction,
	getCangjieGlobalEvalTracePath,
	getCangjieWorkspaceEvalTracePath,
	readCangjieEvalTraceSummary,
	summarizeCangjieEvalTraceJsonl,
} from "../CangjieEvalTraceLogger"

describe("CangjieEvalTraceLogger", () => {
	it("infers a missing write revision from a successful delegated apply_patch call", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cangjie-eval-write-fallback-"))

		await appendCangjieEvalTrace({
			taskId: "write-fallback",
			cwd,
			mode: "cangjie",
			stage: "attempt_completion",
			result: "Patch applied.",
			toolUsage: { apply_patch: { attempts: 2, failures: 0 } },
			runtimeSnapshot: {
				writeRevision: 0,
				validatedRevision: 0,
				recentBuildSucceeded: false,
				recentBuildFailed: false,
				compileFailureRounds: 0,
				stagnantFailureRounds: 0,
				searchedStdModules: [],
				corpusReadModules: [],
				corpusReadPathCount: 0,
				pendingEvidenceModules: [],
				evidenceRecordCount: 0,
			},
		})

		const entries = fs
			.readFileSync(getCangjieWorkspaceEvalTracePath(cwd), "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line))
		expect(entries[0]?.runtimeSnapshot).toEqual(
			expect.objectContaining({
				writeRevision: 1,
				validatedRevision: 0,
			}),
		)
	})

	let tmpDir: string
	let workspaceDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cangjie-eval-trace-"))
		workspaceDir = path.join(tmpDir, "workspace")
		fs.mkdirSync(workspaceDir, { recursive: true })
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
		fs.rmSync(path.join(path.dirname(tmpDir), `.${path.basename(tmpDir)}-cangjie-roadmap`), {
			recursive: true,
			force: true,
		})
	})

	it("uses the workspace trace directory with a hyphen", () => {
		expect(getCangjieWorkspaceEvalTracePath(workspaceDir)).toBe(
			path.join(workspaceDir, ".njust-ai", "cangjie-eval-trace.jsonl"),
		)
	})

	it("writes global and per-task JSONL entries", async () => {
		await appendCangjieEvalTrace({
			globalStoragePath: tmpDir,
			taskId: "task-1",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion",
			result: "Cangjie evidence audit:\n\ncjpm build success",
			taskText: "Create a minimal Cangjie hello world program that builds.",
			runtimeSnapshot: {
				writeRevision: 2,
				validatedRevision: 2,
				recentBuildSucceeded: true,
				recentBuildFailed: false,
				compileFailureRounds: 0,
				stagnantFailureRounds: 0,
				searchedStdModules: ["std.fs"],
				corpusReadModules: ["std.fs"],
				corpusReadPathCount: 1,
				pendingEvidenceModules: [],
				evidenceRecordCount: 2,
				recentBuildCommand: "cjpm build",
			},
		})

		const globalTrace = await getCangjieGlobalEvalTracePath(tmpDir)
		const taskTrace = path.join(tmpDir, "tasks", "task-1", "cangjie-eval-trace.jsonl")
		const workspaceTrace = path.join(workspaceDir, ".njust-ai", "cangjie-eval-trace.jsonl")
		expect(fs.existsSync(globalTrace)).toBe(true)
		expect(fs.existsSync(taskTrace)).toBe(true)
		expect(fs.existsSync(workspaceTrace)).toBe(true)

		const entry = JSON.parse(fs.readFileSync(globalTrace, "utf8").trim())
		expect(entry).toMatchObject({
			taskId: "task-1",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion",
			attemptNumber: 1,
			priorBlockedAttempts: 0,
			verdict: "passed",
			hasCangjieEvidenceAudit: true,
			mentionsBuildSuccess: true,
			evalCaseId: "hello-world-project",
			runtimeSnapshot: {
				writeRevision: 2,
				validatedRevision: 2,
				recentBuildSucceeded: true,
				evidenceRecordCount: 2,
			},
		})
	})

	it("migrates the legacy global trace to a sibling directory that survives extension reinstall", async () => {
		const legacyTracePath = path.join(tmpDir, "cangjie-eval-trace.jsonl")
		const legacyEntry = `${JSON.stringify({ taskId: "legacy", verdict: "passed" })}\n`
		fs.writeFileSync(legacyTracePath, legacyEntry)

		const durableTracePath = await getCangjieGlobalEvalTracePath(tmpDir)

		expect(durableTracePath).toBe(
			path.join(path.dirname(tmpDir), `.${path.basename(tmpDir)}-cangjie-roadmap`, "cangjie-eval-trace.jsonl"),
		)
		expect(fs.readFileSync(durableTracePath, "utf8")).toBe(legacyEntry)
	})

	it("summarizes roadmap eval case coverage by root task", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({
					taskId: "child-explore",
					rootTaskId: "root-hello",
					evalCaseId: "hello-world-project",
					verdict: "unknown",
				}),
				JSON.stringify({
					taskId: "child-verify",
					rootTaskId: "root-hello",
					evalCaseId: "hello-world-project",
					verdict: "passed",
				}),
				JSON.stringify({
					taskId: "root-regex",
					evalCaseId: "regex-match",
					verdict: "failed",
				}),
				JSON.stringify({
					taskId: "legacy-task",
					verdict: "passed",
				}),
			].join("\n"),
		)

		expect(summary.distinctTaskCount).toBe(3)
		expect(summary.coveredEvalCaseIds).toEqual(["hello-world-project", "regex-match"])
		expect(summary.passedEvalCaseIds).toEqual(["hello-world-project"])
		expect(summary.missingEvalCaseIds).toHaveLength(8)
		expect(summary.missingEvalCaseIds).not.toContain("hello-world-project")
		expect(summary.missingEvalCaseIds).not.toContain("regex-match")
		expect(summary.evalCaseCoverageRate).toBe(0.2)
		expect(summary.latestEvalCaseId).toBeUndefined()
		expect(summary.nextEvalCaseId).toBe("package-mismatch")
	})

	it("corrects a stale ArrayList case id when the final result clearly reports HashMap", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "root-hashmap",
				evalCaseId: "arraylist-usage",
				stage: "attempt_completion",
				verdict: "passed",
				resultPreview:
					"Implemented countStrings(values: Array<String>): HashMap<String, Int64>. cjpm build success.",
			}),
		)

		expect(summary.latestEvalCaseId).toBe("hashmap-usage")
		expect(summary.coveredEvalCaseIds).toEqual(["hashmap-usage"])
		expect(summary.passedEvalCaseIds).toEqual(["hashmap-usage"])
	})

	it("corrects a stale package case id when the final result clearly reports file reading", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "root-file-read",
				evalCaseId: "package-mismatch",
				stage: "attempt_completion",
				verdict: "passed",
				resultPreview:
					"package file_read_demo\nImplemented readTextFile(path: String) with std.fs.File.readFrom. cjpm build success.",
			}),
		)

		expect(summary.latestEvalCaseId).toBe("file-read")
		expect(summary.coveredEvalCaseIds).toEqual(["file-read"])
		expect(summary.passedEvalCaseIds).toEqual(["file-read"])
	})

	it("records structured task-level retry details for plugin-side result reading", async () => {
		await appendCangjieEvalTrace({
			globalStoragePath: tmpDir,
			taskId: "task-2",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion_blocked",
			blockReason:
				"Completion blocked in Cangjie mode: the final report makes an unsupported HashMap.add let/var mutability claim.",
			result: [
				"Cangjie evidence audit:",
				"- corpus read: std.collection (CangjieCorpus-1.0.0/libs/std/collection/collection_package_class.md)",
				"let can call add",
			].join("\n"),
		})

		await appendCangjieEvalTrace({
			globalStoragePath: tmpDir,
			taskId: "task-2",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion",
			result: [
				"Cangjie evidence audit:",
				"- corpus read: std.collection (CangjieCorpus-1.0.0/libs/std/collection/collection_package_class.md)",
				"- corpus read: std.core (CangjieCorpus-1.0.0/libs/std/core/core_package_enums.md)",
			].join("\n"),
		})

		const taskTrace = path.join(tmpDir, "tasks", "task-2", "cangjie-eval-trace.jsonl")
		const entries = fs
			.readFileSync(taskTrace, "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line))

		expect(entries[0]).toMatchObject({
			attemptNumber: 1,
			priorBlockedAttempts: 0,
			priorBlockReasonCodes: [],
			blockReasonCode: "unsupported-hashmap-mutability",
			verdict: "blocked",
			detectedEvidenceModules: ["std.collection"],
		})
		expect(entries[1]).toMatchObject({
			attemptNumber: 2,
			priorBlockedAttempts: 1,
			priorBlockReasonCodes: ["unsupported-hashmap-mutability"],
			verdict: "passed",
			detectedEvidenceModules: ["std.collection", "std.core"],
		})
	})

	it("summarizes JSONL traces for quick plugin-side result reading", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({
					taskId: "task-1",
					stage: "attempt_completion_blocked",
					verdict: "blocked",
					blockReasonCode: "context-audit-scope",
					injectedContextLabels: ["toolchain-rules"],
				}),
				"{not-json",
				JSON.stringify({
					taskId: "task-1",
					stage: "attempt_completion",
					verdict: "passed",
					attemptNumber: 2,
					priorBlockedAttempts: 1,
					injectedContextLabels: ["toolchain-rules", "stdlib-signature-hints"],
				}),
			].join("\n"),
		)

		expect(summary.totalEntries).toBe(3)
		expect(summary.validEntries).toBe(2)
		expect(summary.corruptEntries).toBe(1)
		expect(summary.verdictCounts).toMatchObject({
			passed: 1,
			blocked: 1,
			failed: 0,
			inconclusive: 0,
			unknown: 0,
		})
		expect(summary.reclassifiedEntries).toBe(0)
		expect(summary.distinctTaskCount).toBe(1)
		expect(summary.taskOutcomeCounts).toMatchObject({ passed: 1, blocked: 0 })
		expect(summary.taskPassRate).toBe(1)
		expect(summary.recoveredPassedTaskCount).toBe(1)
		expect(summary.attentionTasks).toEqual([])
		expect(summary.latestTaskId).toBe("task-1")
		expect(summary.latestStage).toBe("attempt_completion")
		expect(summary.latestAttemptNumber).toBe(2)
		expect(summary.latestPriorBlockedAttempts).toBe(1)
		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestVerdictStreak).toBe(1)
		expect(summary.recentBlockReasonCodes).toEqual(["context-audit-scope"])
		expect(summary.recentBlockReasonCounts).toEqual({ "context-audit-scope": 1 })
		expect(summary.latestInjectedContextLabels).toEqual(["toolchain-rules", "stdlib-signature-hints"])
	})

	it("returns an empty summary for blank traces", () => {
		const summary = summarizeCangjieEvalTraceJsonl("\n\n")

		expect(summary).toMatchObject({
			totalEntries: 0,
			validEntries: 0,
			corruptEntries: 0,
			latestInjectedContextLabels: [],
			latestVerdictStreak: 0,
			recentBlockReasonCodes: [],
			recentBlockReasonCounts: {},
			distinctTaskCount: 0,
			taskOutcomeCounts: { passed: 0, blocked: 0, failed: 0, inconclusive: 0, unknown: 0 },
			taskPassRate: 0,
			recoveredPassedTaskCount: 0,
			reclassifiedEntries: 0,
			attentionTasks: [],
			taskBehaviorCounts: {
				withRuntimeSnapshot: 0,
				withAgentDelegation: 0,
				withBuildCommand: 0,
				withCorpusRead: 0,
				withWrites: 0,
				withValidatedWrites: 0,
				withUnvalidatedWrites: 0,
				withPendingEvidence: 0,
				withCompileFailures: 0,
			},
			coveredEvalCaseIds: [],
			passedEvalCaseIds: [],
			missingEvalCaseIds: [
				"hello-world-project",
				"package-mismatch",
				"main-signature-error",
				"arraylist-usage",
				"hashmap-usage",
				"file-read",
				"regex-match",
				"mut-let-error",
				"cjpm-toml-inline-table-error",
				"build-failure-repair-loop",
			],
			evalCaseCoverageRate: 0,
		})
		expect(summary.latestEntry).toBeUndefined()
		expect(summary.latestVerdict).toBeUndefined()
	})

	it("summarizes task behavior coverage from runtime snapshots", () => {
		const baseSnapshot = {
			writeRevision: 1,
			validatedRevision: 1,
			recentBuildSucceeded: true,
			recentBuildFailed: false,
			compileFailureRounds: 0,
			stagnantFailureRounds: 0,
			searchedStdModules: [],
			corpusReadModules: ["std.fs"],
			corpusReadPathCount: 1,
			pendingEvidenceModules: [],
			evidenceRecordCount: 1,
			recentBuildCommand: "cjpm build",
		}
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({ taskId: "task-runtime-a", verdict: "passed", runtimeSnapshot: baseSnapshot }),
				JSON.stringify({
					taskId: "task-runtime-b",
					verdict: "blocked",
					runtimeSnapshot: {
						...baseSnapshot,
						recentBuildSucceeded: false,
						recentBuildFailed: true,
						compileFailureRounds: 2,
						pendingEvidenceModules: ["std.regex"],
						recentBuildCommand: undefined,
					},
				}),
			].join("\n"),
		)

		expect(summary.taskBehaviorCounts).toEqual({
			withRuntimeSnapshot: 2,
			withAgentDelegation: 0,
			withBuildCommand: 1,
			withCorpusRead: 2,
			withWrites: 2,
			withValidatedWrites: 2,
			withUnvalidatedWrites: 0,
			withPendingEvidence: 1,
			withCompileFailures: 1,
		})
	})

	it("counts the trailing verdict streak for stable plugin-side results", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({ taskId: "task-6", stage: "attempt_completion", verdict: "failed" }),
				JSON.stringify({ taskId: "task-7", stage: "attempt_completion", verdict: "passed" }),
				JSON.stringify({ taskId: "task-8", stage: "attempt_completion", verdict: "passed" }),
				JSON.stringify({ taskId: "task-9", stage: "attempt_completion", verdict: "passed" }),
			].join("\n"),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestVerdictStreak).toBe(3)
	})

	it("reclassifies stale legacy verdicts with the current policy without changing stored counts", () => {
		const labels = ["toolchain-rules", "project-overview", "mandatory-corpus-footer"]
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({
					taskId: "legacy-unknown",
					stage: "attempt_completion",
					verdict: "unknown",
					resultPreview: `Cangjie context injection audit:\n${labels.join("\n")}`,
				}),
				JSON.stringify({
					taskId: "legacy-failed",
					stage: "attempt_completion",
					verdict: "failed",
					resultPreview: [
						"Cangjie context injection audit:",
						...labels,
						"未读取项目状态、未分析源码、未修改文件。",
					].join("\n"),
				}),
			].join("\n"),
		)

		expect(summary.verdictCounts).toMatchObject({ failed: 1, unknown: 1, passed: 0 })
		expect(summary.reclassifiedEntries).toBe(2)
		expect(summary.taskOutcomeCounts).toMatchObject({ passed: 2, failed: 0, unknown: 0 })
		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestVerdictStreak).toBe(2)
		expect(summary.attentionTasks).toEqual([])
	})

	it("reclassifies a legacy unknown context audit with project status as a scoped failure", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "legacy-context-scope",
				stage: "attempt_completion",
				attemptNumber: 1,
				verdict: "unknown",
				resultPreview: [
					"## Cangjie 上下文注入审计",
					"toolchain-rules",
					"mandatory-corpus-footer",
					"## 当前项目状态",
					"源文件：3 个",
				].join("\n"),
			}),
		)

		expect(summary.verdictCounts).toMatchObject({ unknown: 1, failed: 0 })
		expect(summary.reclassifiedEntries).toBe(1)
		expect(summary.taskOutcomeCounts).toMatchObject({ unknown: 0, failed: 1 })
		expect(summary.latestVerdict).toBe("failed")
		expect(summary.attentionTasks).toEqual([
			expect.objectContaining({
				taskId: "legacy-context-scope",
				verdict: "failed",
				reason: "context-audit-scope",
				attemptNumber: 1,
			}),
		])
	})

	it("counts only the latest outcome for each distinct task", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({ taskId: "task-a", stage: "attempt_completion_blocked", verdict: "blocked" }),
				JSON.stringify({ taskId: "task-b", stage: "attempt_completion", verdict: "failed", attemptNumber: 5 }),
				JSON.stringify({ taskId: "task-a", stage: "attempt_completion", verdict: "passed" }),
			].join("\n"),
		)

		expect(summary.distinctTaskCount).toBe(2)
		expect(summary.taskOutcomeCounts).toEqual({
			passed: 1,
			blocked: 0,
			failed: 1,
			inconclusive: 0,
			unknown: 0,
		})
		expect(summary.taskPassRate).toBe(0.5)
		expect(summary.recoveredPassedTaskCount).toBe(0)
		expect(summary.attentionTasks).toHaveLength(1)
		expect(summary.attentionTasks[0]).toMatchObject({
			taskId: "task-b",
			verdict: "failed",
			reason: "failed-result",
			stage: "attempt_completion",
			attemptNumber: 5,
		})
		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain("task-b (failed: failed-result, attempt 5)")
	})

	it("keeps the most recent block reason codes for recurring gate diagnosis", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({
					taskId: "task-10",
					stage: "attempt_completion_blocked",
					verdict: "blocked",
					blockReasonCode: "missing-stdlib-evidence",
				}),
				JSON.stringify({
					taskId: "task-10",
					stage: "attempt_completion_blocked",
					verdict: "blocked",
					blockReasonCode: "context-audit-scope",
				}),
				JSON.stringify({
					taskId: "task-10",
					stage: "attempt_completion",
					verdict: "passed",
				}),
			].join("\n"),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestVerdictStreak).toBe(1)
		expect(summary.recentBlockReasonCodes).toEqual(["context-audit-scope", "missing-stdlib-evidence"])
		expect(summary.recentBlockReasonCounts).toEqual({
			"context-audit-scope": 1,
			"missing-stdlib-evidence": 1,
		})
	})

	it("aggregates repeated recent block reasons", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({ taskId: "task-11", verdict: "blocked", blockReasonCode: "pending-build" }),
				JSON.stringify({ taskId: "task-12", verdict: "blocked", blockReasonCode: "pending-build" }),
				JSON.stringify({ taskId: "task-13", verdict: "blocked", blockReasonCode: "build-failed" }),
			].join("\n"),
		)

		expect(summary.recentBlockReasonCounts).toEqual({ "build-failed": 1, "pending-build": 2 })
		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain(
			"- recent block reasons: build-failed, pending-build x2",
		)
	})

	it("reads trace summaries from disk and tolerates missing files", async () => {
		const tracePath = path.join(workspaceDir, ".njust-ai", "cangjie-eval-trace.jsonl")
		fs.mkdirSync(path.dirname(tracePath), { recursive: true })
		fs.writeFileSync(
			tracePath,
			[
				JSON.stringify({ taskId: "task-3", stage: "attempt_completion", verdict: "inconclusive" }),
				JSON.stringify({ taskId: "task-3", stage: "attempt_completion", verdict: "passed" }),
			].join("\n"),
		)

		const summary = await readCangjieEvalTraceSummary(tracePath)
		expect(summary.totalEntries).toBe(2)
		expect(summary.latestVerdict).toBe("passed")
		expect(summary.verdictCounts.passed).toBe(1)
		expect(summary.verdictCounts.inconclusive).toBe(1)

		const missing = await readCangjieEvalTraceSummary(path.join(workspaceDir, "missing.jsonl"))
		expect(missing.totalEntries).toBe(0)
		expect(missing.latestVerdict).toBeUndefined()
	})

	it("formats trace summaries as short markdown reports", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				JSON.stringify({
					taskId: "task-4",
					stage: "attempt_completion_blocked",
					verdict: "blocked",
					blockReasonCode: "context-audit-scope",
				}),
				JSON.stringify({
					taskId: "task-4",
					stage: "attempt_completion",
					verdict: "passed",
					attemptNumber: 2,
					priorBlockedAttempts: 1,
					injectedContextLabels: ["toolchain-rules", "mandatory-corpus-footer"],
				}),
			].join("\n"),
		)

		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toBe(
			[
				"Cangjie eval trace summary:",
				"- total entries: 2 (2 valid, 0 corrupt)",
				"- latest verdict: passed",
				"- latest verdict streak: 1",
				"- latest task: task-4",
				"- latest eval case: none",
				"- latest stage: attempt_completion",
				"- latest task attempt: 2",
				"- prior blocked attempts: 1",
				"- stored verdict counts: passed: 1, blocked: 1",
				"- entries reclassified by current policy: 0",
				"- distinct tasks: 1",
				"- task outcomes (latest per task): passed: 1",
				"- task pass rate: 100.0%",
				"- recovered passed tasks: 1",
				"- eval case coverage: 0/10 (0.0%); passed 0; missing 10",
				"- task behavior coverage: snapshots 0/1; agent delegation 0; build 0; corpus 0; writes 0; validated writes 0; unvalidated writes 0; pending evidence 0; compile failures 0",
				"- latest injected context labels: toolchain-rules, mandatory-corpus-footer",
				"- missing eval cases: hello-world-project, package-mismatch, main-signature-error, arraylist-usage, hashmap-usage, file-read, regex-match, mut-let-error, cjpm-toml-inline-table-error, build-failure-repair-loop",
				"- recent block reasons: context-audit-scope",
				"- next action: Run the next uncovered Cangjie eval case: hello-world-project (0/10 covered).",
			].join("\n"),
		)
	})

	it("recommends a targeted next action for each trace verdict", () => {
		const makeSummary = (verdict?: "passed" | "blocked" | "failed" | "inconclusive" | "unknown") => ({
			totalEntries: verdict ? 1 : 0,
			validEntries: verdict ? 1 : 0,
			corruptEntries: 0,
			verdictCounts: { passed: 0, blocked: 0, failed: 0, inconclusive: 0, unknown: 0 },
			reclassifiedEntries: 0,
			distinctTaskCount: verdict ? 1 : 0,
			taskOutcomeCounts: { passed: 0, blocked: 0, failed: 0, inconclusive: 0, unknown: 0 },
			taskPassRate: verdict === "passed" ? 1 : 0,
			recoveredPassedTaskCount: 0,
			attentionTasks: [],
			taskBehaviorCounts: {
				withRuntimeSnapshot: 0,
				withAgentDelegation: 0,
				withBuildCommand: 0,
				withCorpusRead: 0,
				withWrites: 0,
				withValidatedWrites: 0,
				withUnvalidatedWrites: 0,
				withPendingEvidence: 0,
				withCompileFailures: 0,
			},
			coveredEvalCaseIds: [],
			passedEvalCaseIds: [],
			missingEvalCaseIds: [],
			evalCaseCoverageRate: 0,
			latestVerdict: verdict,
			latestVerdictStreak: verdict ? 1 : 0,
			latestEvalCaseId: undefined,
			nextEvalCaseId: undefined,
			latestBlockReasonCode: verdict === "blocked" ? "pending-build" : undefined,
			recentBlockReasonCodes: [],
			recentBlockReasonCounts: {},
			latestInjectedContextLabels: [],
		})

		expect(getCangjieEvalTraceNextAction(makeSummary())).toContain("create an eval trace")
		expect(getCangjieEvalTraceNextAction(makeSummary("passed"))).toContain("next roadmap stage")
		expect(getCangjieEvalTraceNextAction(makeSummary("blocked"))).toContain("pending-build")
		expect(getCangjieEvalTraceNextAction(makeSummary("failed"))).toContain("latest result preview")
		expect(getCangjieEvalTraceNextAction(makeSummary("inconclusive"))).toContain("real compiler")
		expect(getCangjieEvalTraceNextAction(makeSummary("unknown"))).toContain("raw trace entry")
	})

	it("recommends the next uncovered roadmap eval case after a passing task", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-hello",
				evalCaseId: "hello-world-project",
				stage: "attempt_completion",
				verdict: "passed",
			}),
		)

		expect(summary.latestEvalCaseId).toBe("hello-world-project")
		expect(summary.nextEvalCaseId).toBe("package-mismatch")
		expect(getCangjieEvalTraceNextAction(summary)).toBe(
			"Run the next uncovered Cangjie eval case: package-mismatch (1/10 covered).",
		)
	})

	it("reports not run when a runtime snapshot has no build command", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-no-build",
				verdict: "passed",
				runtimeSnapshot: {
					writeRevision: 0,
					validatedRevision: 0,
					recentBuildSucceeded: true,
					recentBuildFailed: false,
					compileFailureRounds: 0,
					stagnantFailureRounds: 0,
					searchedStdModules: [],
					corpusReadModules: [],
					corpusReadPathCount: 0,
					pendingEvidenceModules: [],
					evidenceRecordCount: 0,
				},
			}),
		)

		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain("- build state: not run;")
		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain("- delegated agents: none")
	})

	it("formats the exact delegated Cangjie agent route", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-agent-route",
				verdict: "passed",
				runtimeSnapshot: {
					writeRevision: 1,
					validatedRevision: 1,
					recentBuildSucceeded: true,
					recentBuildFailed: false,
					compileFailureRounds: 0,
					stagnantFailureRounds: 0,
					searchedStdModules: ["std.collection"],
					corpusReadModules: ["std.collection"],
					corpusReadPathCount: 1,
					pendingEvidenceModules: [],
					evidenceRecordCount: 1,
					recentBuildCommand: "cjpm build",
					delegatedAgentTypes: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
				},
			}),
		)

		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain(
			"- delegated agents: CangjieExplore -> CangjieImplement -> CangjieVerify",
		)
		expect(summary.taskBehaviorCounts.withAgentDelegation).toBe(1)
	})

	it("rolls child-agent behavior into the root user task", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				{
					taskId: "implement-child",
					rootTaskId: "root-task",
					parentTaskId: "root-task",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 1,
						validatedRevision: 0,
						recentBuildSucceeded: false,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
					},
				},
				{
					taskId: "verify-child",
					rootTaskId: "root-task",
					parentTaskId: "root-task",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 0,
						validatedRevision: 0,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
						recentBuildCommand: "cjpm build",
					},
				},
				{
					taskId: "explore-child",
					rootTaskId: "root-task",
					parentTaskId: "root-task",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 0,
						validatedRevision: 0,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: ["std.collection"],
						corpusReadModules: ["std.collection"],
						corpusReadPathCount: 1,
						pendingEvidenceModules: [],
						evidenceRecordCount: 1,
					},
				},
				{
					taskId: "root-task",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 0,
						validatedRevision: 0,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
						delegatedAgentTypes: ["CangjieExplore", "CangjieVerify"],
					},
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		)

		expect(summary.distinctTaskCount).toBe(1)
		expect(summary.latestTaskId).toBe("root-task")
		expect(summary.taskOutcomeCounts.passed).toBe(1)
		expect(summary.taskBehaviorCounts).toMatchObject({
			withRuntimeSnapshot: 1,
			withAgentDelegation: 1,
			withBuildCommand: 1,
			withCorpusRead: 1,
			withWrites: 1,
			withValidatedWrites: 1,
			withUnvalidatedWrites: 0,
		})
		expect(summary.latestRuntimeSnapshot).toMatchObject({
			writeRevision: 1,
			validatedRevision: 1,
			recentBuildCommand: "cjpm build",
			corpusReadModules: ["std.collection"],
			delegatedAgentTypes: ["CangjieExplore", "CangjieVerify"],
		})
	})

	it("uses the aggregated root task verdict when the final raw entry lacks build state", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				{
					taskId: "verify-child",
					rootTaskId: "root-task",
					parentTaskId: "root-task",
					evalCaseId: "package-mismatch",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 1,
						validatedRevision: 1,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
						recentBuildCommand: "cjpm build",
					},
				},
				{
					taskId: "root-task",
					evalCaseId: "package-mismatch",
					stage: "attempt_completion",
					verdict: "unknown",
					resultPreview: "Task completed without a compiler summary.",
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestVerdictStreak).toBe(1)
		expect(summary.taskOutcomeCounts.passed).toBe(1)
		expect(summary.attentionTasks).toEqual([])
		expect(summary.nextEvalCaseId).toBe("hello-world-project")
	})

	it("reclassifies a quoted historical compiler error after the root build succeeds", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				{
					taskId: "repair-child",
					rootTaskId: "root-task",
					stage: "attempt_completion",
					verdict: "unknown",
					runtimeSnapshot: {
						writeRevision: 1,
						validatedRevision: 0,
						recentBuildSucceeded: false,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
					},
				},
				{
					taskId: "verify-child",
					rootTaskId: "root-task",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 0,
						validatedRevision: 0,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
						recentBuildCommand: "cjpm build",
					},
				},
				{
					taskId: "root-task",
					stage: "attempt_completion",
					verdict: "failed",
					mentionsBuildSuccess: true,
					resultPreview:
						"Project source issue: Error: package name is wrong. Fixed the declaration. cjpm build success.",
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.taskOutcomeCounts.passed).toBe(1)
		expect(summary.attentionTasks).toEqual([])
	})

	it("recovers the main signature case from a legacy successful root report", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				{
					taskId: "repair-child",
					rootTaskId: "root-main",
					stage: "attempt_completion",
					verdict: "failed",
					resultPreview:
						"error: return type of 'main' is not 'Integer' or 'Unit'. 已将 main 函数签名改为 Int64。",
					runtimeSnapshot: {
						writeRevision: 1,
						validatedRevision: 0,
						recentBuildSucceeded: false,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
					},
				},
				{
					taskId: "verify-child",
					rootTaskId: "root-main",
					stage: "attempt_completion",
					verdict: "passed",
					runtimeSnapshot: {
						writeRevision: 0,
						validatedRevision: 0,
						recentBuildSucceeded: true,
						recentBuildFailed: false,
						compileFailureRounds: 0,
						stagnantFailureRounds: 0,
						searchedStdModules: [],
						corpusReadModules: [],
						corpusReadPathCount: 0,
						pendingEvidenceModules: [],
						evidenceRecordCount: 0,
						recentBuildCommand: "cjpm build",
					},
				},
				{
					taskId: "root-main",
					stage: "attempt_completion",
					verdict: "failed",
					mentionsBuildSuccess: false,
					resultPreview:
						"原始错误：return type of 'main' is not 'Integer' or 'Unit'。修复 main 函数签名后，cjpm build 已通过（退出码 0）。",
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.latestEvalCaseId).toBe("main-signature-error")
		expect(summary.coveredEvalCaseIds).toContain("main-signature-error")
		expect(summary.passedEvalCaseIds).toContain("main-signature-error")
		expect(summary.attentionTasks).toEqual([])
	})

	it("does not label ordinary project repair reports as context audit scope failures", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-package-repair",
				stage: "attempt_completion",
				verdict: "failed",
				mentionsBuildSuccess: true,
				hasCangjieContextInjectionAudit: false,
				resultPreview:
					"Project source issue: package wrong. Fixed src/foo/bar.cj. Verification: cjpm build success.",
				runtimeSnapshot: {
					writeRevision: 1,
					validatedRevision: 1,
					recentBuildSucceeded: true,
					recentBuildFailed: false,
					compileFailureRounds: 0,
					stagnantFailureRounds: 0,
					searchedStdModules: [],
					corpusReadModules: [],
					corpusReadPathCount: 0,
					pendingEvidenceModules: [],
					evidenceRecordCount: 0,
					recentBuildCommand: "cjpm build",
				},
			}),
		)

		expect(summary.latestVerdict).toBe("passed")
		expect(summary.attentionTasks).toEqual([])
	})

	it("does not let build success override a semantic completion failure", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-semantic-failure",
				stage: "attempt_completion",
				verdict: "failed",
				mentionsBuildSuccess: true,
				forbiddenHashMapPhrases: ["add 必须 var"],
				resultPreview: "add 必须 var. cjpm build success.",
				runtimeSnapshot: {
					writeRevision: 1,
					validatedRevision: 1,
					recentBuildSucceeded: true,
					recentBuildFailed: false,
					compileFailureRounds: 0,
					stagnantFailureRounds: 0,
					searchedStdModules: [],
					corpusReadModules: [],
					corpusReadPathCount: 0,
					pendingEvidenceModules: [],
					evidenceRecordCount: 0,
					recentBuildCommand: "cjpm build",
				},
			}),
		)

		expect(summary.latestVerdict).toBe("failed")
		expect(summary.attentionTasks).toHaveLength(1)
	})

	it("reclassifies unknown completion verdicts from conclusive compiler snapshots", () => {
		const runtimeSnapshot = {
			writeRevision: 0,
			validatedRevision: 0,
			recentBuildSucceeded: true,
			recentBuildFailed: false,
			compileFailureRounds: 0,
			stagnantFailureRounds: 0,
			searchedStdModules: [],
			corpusReadModules: [],
			corpusReadPathCount: 0,
			pendingEvidenceModules: [],
			evidenceRecordCount: 0,
			recentBuildCommand: "cjpm build",
		}
		const summary = summarizeCangjieEvalTraceJsonl(
			[
				{
					taskId: "successful-build",
					stage: "attempt_completion",
					verdict: "unknown",
					resultPreview: "historical mojibake",
					runtimeSnapshot,
				},
				{
					taskId: "failed-build",
					stage: "attempt_completion",
					verdict: "unknown",
					resultPreview: "historical mojibake",
					runtimeSnapshot: {
						...runtimeSnapshot,
						recentBuildSucceeded: false,
						recentBuildFailed: true,
						compileFailureRounds: 1,
					},
				},
				{
					taskId: "no-build",
					stage: "attempt_completion",
					verdict: "unknown",
					resultPreview: "historical mojibake",
					runtimeSnapshot: {
						...runtimeSnapshot,
						recentBuildCommand: undefined,
					},
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		)

		expect(summary.reclassifiedEntries).toBe(2)
		expect(summary.taskOutcomeCounts).toMatchObject({
			passed: 1,
			failed: 1,
			unknown: 1,
		})
	})

	it("includes the latest block reason in formatted blocked summaries", () => {
		const summary = summarizeCangjieEvalTraceJsonl(
			JSON.stringify({
				taskId: "task-5",
				stage: "attempt_completion_blocked",
				verdict: "blocked",
				blockReasonCode: "missing-stdlib-evidence",
				injectedContextLabels: [],
			}),
		)

		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain(
			"- latest block reason: missing-stdlib-evidence",
		)
		expect(formatCangjieEvalTraceSummaryMarkdown(summary)).toContain(
			"- recent block reasons: missing-stdlib-evidence",
		)
	})

	it("writes a workspace mirror even when global storage is unavailable", async () => {
		await appendCangjieEvalTrace({
			taskId: "task-workspace-only",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion",
			result: "Cangjie evidence audit:\n\ncjpm build success",
		})

		const workspaceTrace = path.join(workspaceDir, ".njust-ai", "cangjie-eval-trace.jsonl")
		expect(fs.existsSync(workspaceTrace)).toBe(true)

		const entry = JSON.parse(fs.readFileSync(workspaceTrace, "utf8").trim())
		expect(entry).toMatchObject({
			taskId: "task-workspace-only",
			cwd: workspaceDir,
			mode: "cangjie",
			stage: "attempt_completion",
			attemptNumber: 1,
			verdict: "passed",
		})
	})

	it("marks HashMap mutability misinformation as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			"结论：add 必须 var。HashMap 变量必须声明为 var。add 不是 mut 方法，不需要 var。",
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("failed")
		expect(analysis.forbiddenHashMapPhrases).toContain("add 必须 var")
		expect(analysis.forbiddenHashMapPhrases).toContain("HashMap 变量必须声明为 var")
		expect(analysis.forbiddenHashMapPhrases).toContain("add 不是 mut")
		expect(analysis.forbiddenHashMapPhrases).toContain("不需要 var")
	})

	it("marks normal Chinese HashMap mutability misinformation as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"\u7ed3\u8bba: add \u662f mut \u65b9\u6cd5, HashMap \u53d8\u91cf\u5fc5\u987b\u7528 var.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("failed")
		expect(analysis.forbiddenHashMapPhrases).toEqual(expect.arrayContaining(["add-is-mut", "hashmap-requires-var"]))
	})

	it("allows cautious HashMap mutability guidance without a magic phrase", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"\u4e0d\u80fd\u65ad\u8a00 add \u5fc5\u987b var; use var only as sample style unless compiler evidence says more.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.forbiddenHashMapPhrases).toEqual([])
	})

	it("allows the fixed HashMap mutability safe phrase", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"var follows the samples; no let/var semantic conclusion is made here.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.forbiddenHashMapPhrases).toEqual([])
	})

	it("fails extra HashMap mutability discussion after the safe phrase", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"var follows the samples; no let/var semantic conclusion is made here.",
				"HashMap 是 class，因此 add 不可能是 mut 方法。",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("failed")
		expect(analysis.forbiddenHashMapPhrases).toContain("method-no-mut-modifier")
	})

	it("does not treat Option default guidance as HashMap mutability discussion", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.get signature is public func get(key: K): ?V.",
				"Option 默认值处理推荐使用 getOrDefault({=> 0})、?? 或 match；下标 [] 在键不存在时抛异常。",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.forbiddenHashMapPhrases).toEqual([])
	})

	it("does not treat ArrayList.add mutability text as HashMap guidance", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"ArrayList<String> uses var result and result.add(value).",
				"The report calls add a mut method.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.forbiddenHashMapPhrases).toEqual([])
	})

	it("allows ordinary HashMap implementations that use var without a semantic claim", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"Implemented countWords with var counts = HashMap<String, Int64>().",
				"Each update calls counts.add(word, next).",
				"cjpm build success",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.forbiddenHashMapPhrases).toEqual([])
	})

	it("marks optional let-or-var HashMap claims as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"Two binding styles are valid; var is optional.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("failed")
		expect(analysis.forbiddenHashMapPhrases).toEqual(
			expect.arrayContaining(["var-unnecessary", "two-binding-styles-valid"]),
		)
	})

	it("marks let binding is enough claims without trailing add as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie evidence audit:",
				"HashMap 是 class 而非 struct，add/get/contains 没有 mut 修饰。",
				"结论：let 绑定即可正常调用，无需 var。",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("failed")
		expect(analysis.forbiddenHashMapPhrases).toEqual(
			expect.arrayContaining(["method-no-mut-modifier", "let-is-enough", "var-unnecessary"]),
		)
	})

	it("does not treat generic compile wording as real cjpm build success", () => {
		const analysis = analyzeCangjieEvalTraceText('示例代码中 map.add("a", 99) 编译通过。', "attempt_completion")

		expect(analysis.mentionsBuildSuccess).toBe(false)
		expect(analysis.verdict).toBe("unknown")
	})

	it("recognizes a Chinese project build success report", () => {
		const analysis = analyzeCangjieEvalTraceText("当前仓颉项目构建成功，没有编译错误。", "attempt_completion")

		expect(analysis.mentionsBuildSuccess).toBe(true)
		expect(analysis.verdict).toBe("passed")
	})

	it("marks accepted evidence reports as passed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			"Cangjie evidence audit:\n- corpus read: std.collection (collection_package_class.md)",
			"attempt_completion",
		)

		expect(analysis.verdict).toBe("passed")
		expect(analysis.hasCangjieEvidenceAudit).toBe(true)
	})

	it("records context injection audit labels separately from evidence audit", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"## Cangjie \u4e0a\u4e0b\u6587\u6ce8\u5165\u5ba1\u8ba1",
				"| 1 | **toolchain-rules** | command policy |",
				"| 2 | **structured-editing-context** | current editor symbols |",
				"| 3 | **project-overview** | package layout |",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieEvidenceAudit).toBe(false)
		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.verdict).toBe("passed")
		expect(analysis.injectedContextLabels).toEqual([
			"toolchain-rules",
			"project-overview",
			"structured-editing-context",
		])
	})

	it("treats context injection lists as context injection audit records", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"## Cangjie \u4e0a\u4e0b\u6587\u6ce8\u5165\u6e05\u5355",
				"1. **toolchain-rules**",
				"2. **project-overview**",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual(["toolchain-rules", "project-overview"])
	})

	it("marks context injection audits without listed labels as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			"Cangjie context injection audit is complete. The report was already submitted. No files were modified.",
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual([])
		expect(analysis.verdict).toBe("failed")
	})

	it("marks context injection audits with project status details as failed", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie context injection audit:",
				"- toolchain-rules",
				"- structured-editing-context",
				"- stdlib-signature-hints",
				"Project status: web v1.0.0 dynamic.",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual([
			"toolchain-rules",
			"stdlib-signature-hints",
			"structured-editing-context",
		])
		expect(analysis.verdict).toBe("failed")
	})

	it("allows context injection audits to say project status and source were not read", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie context injection audit:",
				"1. toolchain-rules",
				"2. structured-editing-context",
				"3. import-to-corpus-doc-map",
				"4. visible-editor-symbols",
				"5. stdlib-signature-hints",
				"6. project-overview",
				"7. contextual-coding-rules",
				"8. style-few-shot",
				"9. learned-fixes",
				"10. mandatory-corpus-footer",
				"未读取项目状态、未分析源码、未修改文件。",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual([
			"toolchain-rules",
			"project-overview",
			"visible-editor-symbols",
			"stdlib-signature-hints",
			"import-to-corpus-doc-map",
			"contextual-coding-rules",
			"style-few-shot",
			"structured-editing-context",
			"learned-fixes",
			"mandatory-corpus-footer",
		])
		expect(analysis.verdict).toBe("passed")
	})

	it("allows context injection audits that only list labels", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"Cangjie context injection audit:",
				"- toolchain-rules",
				"- structured-editing-context",
				"- stdlib-signature-hints",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual([
			"toolchain-rules",
			"stdlib-signature-hints",
			"structured-editing-context",
		])
		expect(analysis.verdict).toBe("passed")
	})

	it("treats injected context labels as a context injection record even without a heading", () => {
		const analysis = analyzeCangjieEvalTraceText(
			[
				"已注入 9 组 Cangjie 上下文。",
				"- **toolchain-rules**",
				"- **stdlib-signature-hints**",
				"- **mandatory-corpus-footer**",
			].join("\n"),
			"attempt_completion",
		)

		expect(analysis.hasCangjieContextInjectionAudit).toBe(true)
		expect(analysis.injectedContextLabels).toEqual([
			"toolchain-rules",
			"stdlib-signature-hints",
			"mandatory-corpus-footer",
		])
	})

	it("marks blocked completions as blocked", () => {
		const analysis = analyzeCangjieEvalTraceText(
			"任务完成",
			"attempt_completion_blocked",
			"Completion blocked in Cangjie mode",
		)

		expect(analysis.verdict).toBe("blocked")
	})
})
