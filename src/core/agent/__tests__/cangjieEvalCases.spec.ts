import { describe, expect, it } from "vitest"

import {
	buildCangjieEvalReport,
	CANGJIE_EVAL_CASES,
	createCangjieEvalRunRecordFromObservation,
	evaluateCangjieObservationMarkdown,
	evaluateCangjieObservations,
	formatCangjieEvalBehavior,
	formatCangjieEvalReportMarkdown,
	getCangjieEvalCase,
	parseCangjieEvalObservationMarkdown,
	resolveCangjieEvalCaseId,
	scoreCangjieEvalRun,
	summarizeCangjieEvalCases,
} from "../cangjieEvalCases"

describe("CANGJIE_EVAL_CASES", () => {
	it("defines the first ten Cangjie evaluation cases from the roadmap", () => {
		expect(CANGJIE_EVAL_CASES).toHaveLength(10)
		expect(CANGJIE_EVAL_CASES.map((testCase) => testCase.id)).toEqual([
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
		])
	})

	it("keeps case ids unique and lookup stable", () => {
		const ids = CANGJIE_EVAL_CASES.map((testCase) => testCase.id)

		expect(new Set(ids).size).toBe(ids.length)
		expect(getCangjieEvalCase("hashmap-usage")?.title).toContain("HashMap")
		expect(getCangjieEvalCase("missing")).toBeUndefined()
	})

	it("resolves common eval case aliases used in pasted notes", () => {
		expect(resolveCangjieEvalCaseId("## HashMap")).toBe("hashmap-usage")
		expect(resolveCangjieEvalCaseId("## file read")).toBe("file-read")
		expect(resolveCangjieEvalCaseId("case: regex-match")).toBe("regex-match")
		expect(resolveCangjieEvalCaseId("**inline table repair**")).toBe("cjpm-toml-inline-table-error")
		expect(resolveCangjieEvalCaseId("请修复 cjpm.toml 的解析错误")).toBe("cjpm-toml-inline-table-error")
		expect(resolveCangjieEvalCaseId("项目包含 cjpm.toml，请在 src/main.cj 新增 squareValue")).toBeUndefined()
		expect(resolveCangjieEvalCaseId("请最小修改修复 main 函数签名，并运行 cjpm build 验证。")).toBe(
			"main-signature-error",
		)
		expect(resolveCangjieEvalCaseId("error: return type of 'main' is not 'Integer' or 'Unit'")).toBe(
			"main-signature-error",
		)
		expect(
			resolveCangjieEvalCaseId(
				"新增 public func countStrings(values: Array<String>): HashMap<String, Int64>，统计每个字符串出现次数。",
			),
		).toBe("hashmap-usage")
		expect(
			resolveCangjieEvalCaseId(
				"HashMap keys cannot be Array or ArrayList; countStrings uses HashMap<String, Int64>.",
			),
		).toBe("hashmap-usage")
		expect(
			resolveCangjieEvalCaseId(
				"package file_read_demo\nImplemented readTextFile(path: String) with std.fs.File.readFrom and cjpm build success.",
			),
		).toBe("file-read")
		expect(resolveCangjieEvalCaseId("A normal package declaration in a project report")).toBeUndefined()
		expect(resolveCangjieEvalCaseId("unknown heading")).toBeUndefined()
	})

	it("requires every case to declare setup, request, evidence, verification, and pass criteria", () => {
		for (const testCase of CANGJIE_EVAL_CASES) {
			expect(testCase.initialProject.length).toBeGreaterThan(0)
			expect(testCase.userRequest.length).toBeGreaterThan(0)
			expect(testCase.expectedAgents.length).toBeGreaterThan(0)
			expect(testCase.requiredEvidence.length).toBeGreaterThan(0)
			expect(testCase.verificationCommands).toContain("cjpm build")
			expect(testCase.passCriteria.length).toBeGreaterThanOrEqual(3)
			expect(testCase.requiredBehaviors).toContain("run-cjpm-build")
			expect(testCase.requiredBehaviors.length).toBeGreaterThan(0)
		}
	})

	it("covers the Cangjie native agent loop expectations", () => {
		const allExpectedAgents = new Set(CANGJIE_EVAL_CASES.flatMap((testCase) => testCase.expectedAgents))

		expect(allExpectedAgents.has("CangjieExplore")).toBe(true)
		expect(allExpectedAgents.has("CangjieImplement")).toBe(true)
		expect(allExpectedAgents.has("CangjieVerify")).toBe(true)
		expect(allExpectedAgents.has("CangjieRepair")).toBe(true)
	})

	it("marks stdlib cases as evidence-gated before implementation", () => {
		const stdlibCases = CANGJIE_EVAL_CASES.filter((testCase) => testCase.category === "stdlib-evidence")

		expect(stdlibCases).toHaveLength(4)
		for (const testCase of stdlibCases) {
			expect(testCase.expectedAgents).toContain("CangjieExplore")
			expect(testCase.expectedAgents).toContain("CangjieImplement")
			expect(testCase.requiredEvidence.join("\n")).toMatch(/CangjieCorpus|libs\/std|corpus/i)
		}
	})

	it("keeps repair cases grounded in real toolchain output", () => {
		const repairCases = CANGJIE_EVAL_CASES.filter((testCase) => testCase.expectedAgents.includes("CangjieRepair"))

		expect(repairCases.length).toBeGreaterThan(0)
		for (const testCase of repairCases) {
			expect(testCase.requiredEvidence.join("\n")).toMatch(/real|compiler|toolchain|cjpm/i)
			expect(testCase.expectedAgents).toContain("CangjieVerify")
		}
	})

	it("summarizes category, agent, and command coverage", () => {
		const summary = summarizeCangjieEvalCases()

		expect(summary.totalCases).toBe(10)
		expect(summary.casesByCategory).toEqual({
			"project-structure": 2,
			entrypoint: 1,
			"stdlib-evidence": 4,
			mutability: 1,
			configuration: 1,
			"repair-loop": 1,
		})
		expect(summary.casesByAgent).toEqual({
			CangjieExplore: 6,
			CangjieImplement: 5,
			CangjieVerify: 10,
			CangjieRepair: 5,
		})
		expect(summary.casesByBehavior["run-cjpm-build"]).toBe(10)
		expect(summary.casesByBehavior["read-corpus-evidence"]).toBe(4)
		expect(summary.casesByBehavior["use-real-toolchain-output"]).toBe(5)
		expect(summary.casesByBehavior["minimal-edits"]).toBe(10)
		expect(summary.casesByBehavior["record-context-injection"]).toBe(1)
		expect(summary.verificationCommands).toEqual(["cjpm build"])
	})

	it("summarizes evidence-gated and repair case ids for reports", () => {
		const summary = summarizeCangjieEvalCases()

		expect(summary.evidenceGatedCaseIds).toEqual(["arraylist-usage", "hashmap-usage", "file-read", "regex-match"])
		expect(summary.repairCaseIds).toEqual([
			"package-mismatch",
			"main-signature-error",
			"mut-let-error",
			"cjpm-toml-inline-table-error",
			"build-failure-repair-loop",
		])
	})

	it("keeps machine-checkable behavior gates aligned with case intent", () => {
		const stdlibCases = CANGJIE_EVAL_CASES.filter((testCase) => testCase.category === "stdlib-evidence")
		const repairCases = CANGJIE_EVAL_CASES.filter((testCase) => testCase.expectedAgents.includes("CangjieRepair"))

		for (const testCase of stdlibCases) {
			expect(testCase.requiredBehaviors).toContain("read-corpus-evidence")
		}
		for (const testCase of repairCases) {
			expect(testCase.requiredBehaviors).toContain("use-real-toolchain-output")
			expect(testCase.requiredBehaviors).toContain("minimal-edits")
		}
		expect(getCangjieEvalCase("cjpm-toml-inline-table-error")?.requiredBehaviors).toContain(
			"allow-inconclusive-if-output-missing",
		)
		expect(getCangjieEvalCase("build-failure-repair-loop")?.requiredBehaviors).toEqual(
			expect.arrayContaining(["report-diagnostic-progress", "stop-on-stagnation"]),
		)
	})

	it("scores a passing eval run when required behaviors and commands are present", () => {
		expect(
			scoreCangjieEvalRun({
				caseId: "hashmap-usage",
				observedBehaviors: [
					"inspect-cjpm-project",
					"read-relevant-source",
					"read-corpus-evidence",
					"run-cjpm-build",
					"minimal-edits",
				],
				commandsRun: ["cjpm build"],
				verificationStatus: "passed",
			}),
		).toEqual({
			caseId: "hashmap-usage",
			status: "passed",
			missingBehaviors: [],
			missingCommands: [],
			verificationStatus: "passed",
			recommendedNextSteps: [],
		})
	})

	it("scores missing behavior and command gates as failed", () => {
		expect(
			scoreCangjieEvalRun({
				caseId: "hashmap-usage",
				observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
				commandsRun: [],
				verificationStatus: "not-run",
			}),
		).toEqual({
			caseId: "hashmap-usage",
			status: "failed",
			missingBehaviors: ["read-corpus-evidence", "run-cjpm-build"],
			missingCommands: ["cjpm build"],
			verificationStatus: "not-run",
			recommendedNextSteps: [
				"Run CangjieExplore to collect bundled Cangjie corpus evidence.",
				"Run CangjieVerify with cjpm build.",
				"Run CangjieVerify before accepting the case.",
			],
		})
	})

	it("allows inconclusive verification only for cases that explicitly permit it", () => {
		expect(
			scoreCangjieEvalRun({
				caseId: "cjpm-toml-inline-table-error",
				observedBehaviors: [
					"use-real-toolchain-output",
					"run-cjpm-build",
					"minimal-edits",
					"no-unrelated-file-edits",
					"allow-inconclusive-if-output-missing",
				],
				commandsRun: ["cjpm build"],
				verificationStatus: "inconclusive",
			}).status,
		).toBe("passed")

		expect(
			scoreCangjieEvalRun({
				caseId: "hello-world-project",
				observedBehaviors: ["inspect-cjpm-project", "run-cjpm-build", "minimal-edits"],
				commandsRun: ["cjpm build"],
				verificationStatus: "inconclusive",
			}).status,
		).toBe("failed")
	})

	it("reports unknown eval cases without pretending to score them", () => {
		expect(
			scoreCangjieEvalRun({
				caseId: "missing",
				observedBehaviors: [],
				commandsRun: [],
				verificationStatus: "not-run",
			}),
		).toEqual({
			caseId: "missing",
			status: "unknown-case",
			missingBehaviors: [],
			missingCommands: [],
			verificationStatus: "not-run",
			recommendedNextSteps: ["Check the case id against CANGJIE_EVAL_CASES."],
		})
	})

	it("creates eval run records from plain plugin-side observations", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Read cjpm.toml and package declaration.",
				"Read relevant .cj source file under src/.",
				"Checked CangjieCorpus-1.0.0/extra/HashMap.md and libs/std/collection corpus evidence.",
				"Made a minimal edit.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})

		expect(record).toEqual({
			caseId: "hashmap-usage",
			observedBehaviors: [
				"inspect-cjpm-project",
				"read-relevant-source",
				"read-corpus-evidence",
				"run-cjpm-build",
				"minimal-edits",
			],
			commandsRun: ["cjpm build"],
			verificationStatus: "passed",
		})
		expect(scoreCangjieEvalRun(record).status).toBe("passed")
	})

	it("maps inconclusive plugin-side observations without treating them as success globally", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Used real toolchain cjpm parse error.",
				"Only changed cjpm.toml with a minimal fix; no unrelated files changed.",
				"Ran cjpm build, but terminal output unavailable, verification inconclusive.",
			].join("\n"),
		})

		expect(record.observedBehaviors).toEqual([
			"inspect-cjpm-project",
			"run-cjpm-build",
			"use-real-toolchain-output",
			"minimal-edits",
			"no-unrelated-file-edits",
			"allow-inconclusive-if-output-missing",
		])
		expect(record.commandsRun).toEqual(["cjpm build"])
		expect(record.verificationStatus).toBe("inconclusive")
		expect(scoreCangjieEvalRun(record).status).toBe("passed")
	})

	it("detects Cangjie context injection audit markers in plugin-side observations", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: [
				"Cangjie Context Injection Audit:",
				"- toolchain-rules",
				"- project-overview",
				"- stdlib-signature-hints",
				"Read relevant src/main.cj source file.",
				"Captured real compiler diagnostic output.",
				"Ran cjpm build and build passed.",
				"Made a minimal edit.",
				"Diagnostics improved after the repair, and stop on stagnation is enabled.",
			].join("\n"),
		})

		expect(record.observedBehaviors).toContain("record-context-injection")
		expect(scoreCangjieEvalRun(record).status).toBe("passed")
	})

	it("flags context injection audits that do not list injected labels", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: "Cangjie Context Injection Audit is complete. The report was already submitted. No files were modified.",
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["context-audit-missing-labels"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"List the actual injected Cangjie context labels in context audit reports.",
		)
	})

	it("flags context injection audits that include project status details", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: [
				"Cangjie Context Injection Audit:",
				"- toolchain-rules",
				"- structured-editing-context",
				"- stdlib-signature-hints",
				"Project status: web v1.0.0 dynamic.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["context-audit-scope"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Keep context injection audits limited to injected labels; omit project status, directory trees, source lists, and symbols unless asked.",
		)
	})

	it("accepts context injection audits that only say project/source status was not read", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: [
				"Cangjie Context Injection Audit:",
				"- toolchain-rules",
				"- structured-editing-context",
				"- import-to-corpus-doc-map",
				"- visible-editor-symbols",
				"- stdlib-signature-hints",
				"- project-overview",
				"- contextual-coding-rules",
				"- style-few-shot",
				"- learned-fixes",
				"- mandatory-corpus-footer",
				"未读取项目状态、未分析源码、未修改文件。",
				"Read relevant src/main.cj source file.",
				"Captured real compiler diagnostic output.",
				"Ran cjpm build and build passed.",
				"Made a minimal edit.",
				"Diagnostics improved after the repair, and stop on stagnation is enabled.",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
	})

	it("accepts clean context injection label-only audit observations", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: [
				"Cangjie Context Injection Audit:",
				"- toolchain-rules",
				"- structured-editing-context",
				"- stdlib-signature-hints",
				"- mandatory-corpus-footer",
				"Read relevant src/main.cj source file.",
				"Captured real compiler diagnostic output.",
				"Ran cjpm build and build passed.",
				"Made a minimal edit.",
				"Diagnostics improved after the repair, and stop on stagnation is enabled.",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
	})

	it("flags rewritten command retries when the user provided an explicit command allowlist", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"The user said only run where.exe cjpm and cjpm build 2>&1.",
				"where.exe cjpm succeeded.",
				"cjpm build 2>&1 produced only a terminal shell integration warning.",
				"Tried another way: cd /d D:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build.",
				"Unable to capture output, verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["command-allowlist-violation", "toolchain-wrapper-command"])
		expect(score.status).toBe("failed")
		expect(score.violations).toEqual(["command-allowlist-violation", "toolchain-wrapper-command"])
		expect(score.recommendedNextSteps).toContain(
			"Respect explicit command allowlists; do not retry with rewritten commands or alternate shells.",
		)
		expect(formatCangjieEvalReportMarkdown(buildCangjieEvalReport([record]))).toContain(
			"Violations: command-allowlist-violation",
		)
		expect(formatCangjieEvalReportMarkdown(buildCangjieEvalReport([record]), { language: "zh" })).toContain(
			"违规：command-allowlist-violation",
		)
		expect(formatCangjieEvalReportMarkdown(buildCangjieEvalReport([record]), { language: "zh" })).toContain(
			"遵守显式命令清单",
		)
	})

	it("flags duplicate allowlisted commands and equivalent PowerShell probes", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Only run where.exe cjpm and cjpm build 2>&1.",
				"Running where.exe cjpm.",
				"Running where.exe cjpm.",
				"where.exe cjpm timed out.",
				'Trying PowerShell instead: powershell -Command "Get-Command cjpm".',
				"verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["command-allowlist-violation", "duplicate-allowlisted-command"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toEqual(
			expect.arrayContaining([
				"Respect explicit command allowlists; do not retry with rewritten commands or alternate shells.",
				"Run each explicitly allowed command at most once unless the user requests a retry.",
			]),
		)
	})

	it("flags asking the user to paste terminal output after missing command output", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Running cjpm build.",
				"Terminal shell integration did not capture output.",
				"能否请您将终端中的构建输出复制粘贴给我？",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["user-output-request"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Do not ask the user to paste terminal output; report verification inconclusive when output is unavailable.",
		)
	})

	it("flags wrapped Cangjie toolchain commands outside explicit allowlist tasks", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Running cd /d d:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build.",
				"Trying another verification: d: && cd d:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build 2>&1.",
				"verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["toolchain-wrapper-command"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Run Cangjie toolchain commands directly; do not wrap them with shell directory switches.",
		)
	})

	it("flags announcing extra project probes in explicit command allowlist tasks", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"User requested: only run cjpm build.",
				"First I will check whether cjpm.toml exists to confirm project exists, then directly execute build.",
				"Running cjpm build.",
				"verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["allowlist-extra-probe-narration"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"For explicit command allowlists, do not announce or plan extra project/file probes.",
		)
	})

	it("flags continued repair edits after diagnostics stagnate", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "build-failure-repair-loop",
			text: [
				"Ran cjpm build and captured real compiler output.",
				"Diagnostics did not improve; errors did not improve after the previous repair.",
				"Continued editing src/main.cj with apply_patch anyway.",
				"Ran cjpm build again and build failed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["stagnant-repair-edit"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"When diagnostics stagnate, gather fresh corpus/LSP evidence before editing again.",
		)
	})

	it("flags unsupported File.readFrom/String.fromUtf8 type-risk speculation", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Read corpus evidence for File.readFrom and String.fromUtf8.",
				"File.readFrom returns Array<Byte>, while String.fromUtf8 accepts Array<UInt8>.",
				"Potential risk: this may fail with a type mismatch and needs confirmation.",
				"No file_samples.md evidence or cjpm build success was cited.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-file-text-risk"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Cite the official std.fs file sample or a successful cjpm build before reporting File.readFrom/String.fromUtf8 as risky.",
		)
	})

	it("flags foreign ArrayList append and insert API shapes", () => {
		const appendRecord = createCangjieEvalRunRecordFromObservation({
			caseId: "arraylist-usage",
			text: [
				"Read cjpm.toml and the relevant Cangjie source.",
				"Read CangjieCorpus ArrayList evidence.",
				'Implemented ArrayList<String> with list.append("a").',
				"Made a minimal edit and ran cjpm build; build passed.",
			].join("\n"),
		})
		const insertRecord = createCangjieEvalRunRecordFromObservation({
			caseId: "arraylist-usage",
			text: [
				"Read cjpm.toml and the relevant Cangjie source.",
				"Read CangjieCorpus ArrayList evidence.",
				'Implemented ArrayList<String> with list.insert(0, "a").',
				"Made a minimal edit and ran cjpm build; build passed.",
			].join("\n"),
		})
		const guidanceRecord = createCangjieEvalRunRecordFromObservation({
			caseId: "arraylist-usage",
			text: [
				"Read cjpm.toml and the relevant Cangjie source.",
				"Read CangjieCorpus ArrayList evidence.",
				"ArrayList should use add; do not use list.append(value).",
				"Made a minimal edit and ran cjpm build; build passed.",
			].join("\n"),
		})

		expect(appendRecord.violations).toContain("foreign-collection-api-shape")
		expect(insertRecord.violations).toContain("foreign-collection-api-shape")
		expect(guidanceRecord.violations).toBeUndefined()
	})

	it("does not flag File.readFrom/String.fromUtf8 reports grounded in the official sample", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Read CangjieCorpus-1.0.0/libs/std/fs/fs_samples/file_samples.md.",
				"The official sample uses File.readFrom and passes the bytes to String.fromUtf8.",
				"Read relevant source and kept edits minimal.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
	})

	it("flags unsafe Option getOrThrow guidance without Some proof", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Read Cangjie source and made a minimal edit.",
				"It is safe to call getOrThrow directly on the Option result.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsafe-option-unwrap-guidance"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Do not recommend unguarded Option.getOrThrow(); prove Some or use ??, getOrDefault, or match.",
		)
	})

	it("accepts Option guidance that handles None explicitly", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Read CangjieCorpus-1.0.0/extra/Option.md.",
				"Use getOrDefault({ => 0 }) or match with case Some(v) and case None before extracting values.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
	})

	it("flags passing default values to Option.getOrThrow", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Read CangjieCorpus Option and HashMap evidence.",
				"Use map.get(word).getOrThrow(0) + 1 when counting strings.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["invalid-option-default-call"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Do not pass defaults to Option.getOrThrow; use ?? or getOrDefault({ => ... }) for default values.",
		)
	})

	it("flags fabricated MatchData defaults for Regex.find Option results", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "regex-match",
			text: [
				"Read CangjieCorpus regex evidence.",
				'For Regex.find defaults, use re.find("abc") ?? MatchData("") to return a fallback match.',
				"Ran cjpm build and build passed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["fabricated-matchdata-default"])
		expect(score.status).toBe("failed")
	})

	it("flags foreign HashMap API names instead of Cangjie collection signatures", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Read collection corpus evidence.",
				"Use HashMap.put(key, value) and HashMap.containsKey(key) for the helper.",
				"Ran cjpm build and build passed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["foreign-collection-api-shape"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Use Cangjie HashMap.add/get/contains/remove signatures from std.collection evidence.",
		)
	})

	it("flags ordinary escaped digit regex strings in Cangjie regex evidence reports", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "regex-match",
			text: [
				"Read CangjieCorpus regex evidence for digit extraction.",
				'Implement extractFirstNumber with Regex("\\\\d+") and re.find(input).',
				"Ran cjpm build and build passed.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["non-raw-regex-digit-pattern"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			'Prefer Cangjie raw regex strings such as Regex(#"\\d+"#) for digit patterns.',
		)
	})

	it("flags evidence-only reports that invite immediate coding", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"- corpus read: std.collection",
				"Investigation report complete. No files were modified.",
				"Tell me if you want implementation.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["evidence-report-invites-coding"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"End evidence-only Cangjie reports with a closed status; do not invite immediate coding.",
		)
	})

	it("flags HashMap subscript assignment when operator evidence is not cited", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Read HashMap add/get/contains evidence.",
				"Recommended countWords implementation:",
				"let prev = counts.get(w) ?? 0",
				"counts[w] = prev + 1",
				"No files were modified.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["uncited-hashmap-subscript-assignment"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Use HashMap.add for count updates unless the report cites operator [](K, value!: V) evidence.",
		)
	})

	it("flags unsupported HashMap.add mutability claims", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Read HashMap add/get evidence.",
				"HashMap.add requires var because add is a mut method, so let cannot be used.",
				"No files were modified.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Do not claim HashMap.add requires var/mut unless compiler or API evidence says so.",
		)
	})

	it("does not flag ArrayList.add mutability text as a HashMap claim", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "arraylist-usage",
			text: [
				"Cangjie evidence audit:",
				"ArrayList<String> uses var result and result.add(value).",
				"The report calls add a mut method.",
				"cjpm build success",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
	})

	it("flags Chinese unsupported HashMap.add var-required conclusions", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"add(key: K, value: V) 签名: public func add(key: K, value: V): Option<V>",
				"证据: 所有样本代码中，声明 HashMap 时都使用 var。",
				"结论: 是的，add 必须通过 var 绑定的变量调用。",
				"关键约束总结: HashMap 变量必须用 var 声明。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags var-is-required HashMap conclusions copied from plugin reports", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"HashMap.add(K, V) 签名 public func add(key: K, value: V): Option<V>",
				"能否断言 add 必须 var？",
				"结论：可以断言 var 是必需的。",
				"使用 var 声明 HashMap，因为要调用 add 修改其状态。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags normal Chinese HashMap mutability conclusions copied from plugin reports", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"HashMap.add signature: public func add(key: K, value: V): Option<V>",
				"\u624b\u518c\u548c\u793a\u4f8b\u4e2d\u5168\u90e8\u4f7f\u7528 var \u58f0\u660e HashMap \u53d8\u91cf.",
				"\u7ed3\u8bba: add \u662f mut \u65b9\u6cd5, HashMap \u53d8\u91cf\u5fc5\u987b\u7528 var.",
				"No files were modified.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags all-samples-use-var HashMap conclusions as unsupported", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"手册和示例中全部使用 var 声明 HashMap 变量。",
				"结论：可以断言 add 必须 var。",
				"因为 HashMap 是引用类型（class），但 add 是 mut 方法（修改内部状态），而 let 绑定的变量不可调用 mut 方法。",
				"若用 let 声明，调用 map.add(...) 或 map[key] = value 会导致编译错误。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual([
			"uncited-hashmap-subscript-assignment",
			"unsupported-hashmap-mutability-claim",
		])
		expect(score.status).toBe("failed")
	})

	it("flags unsupported let-is-recommended HashMap mutability conclusions", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"HashMap.add 签名 public func add(key: K, value: V): Option<V>",
				"HashMap 是 class，let 绑定不可变引用但可以调用其 mut 方法修改内部状态。",
				"因此 let map = HashMap<String, Int64>() 后调用 map.add(...) 是合法且推荐的写法。不需要 var。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags reference-type HashMap conclusions that let is enough", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"HashMap 本身是引用类型，用 let 绑定即可调用 add/get/contains 等 mut 方法。",
				"在计数函数中，如果只需要在函数内部创建 HashMap 并调用 add/get，let 就足够了。",
				"但为了清晰和一致性，使用 var 也没有问题。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags builtin mut-fix hints applied to HashMap.add", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Cangjie evidence audit:",
				"内置修复提示也确认：let 绑定的实例不能调用 mut 方法（add 是 mut 方法，会修改 HashMap 内部状态），必须改为 var。",
				"关键约束：HashMap 变量必须声明为 var（不能是 let）。",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["unsupported-hashmap-mutability-claim"])
		expect(score.status).toBe("failed")
	})

	it("flags duplicate full reports after attempt_completion timeout", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"Task completion report",
				"Cangjie evidence audit:",
				"Read CangjieCorpus HashMap evidence and did not modify files.",
				"Error completing task: Promise timed out after 120000 milliseconds",
				"Task completion report",
				"Cangjie evidence audit:",
				"Read CangjieCorpus HashMap evidence and did not modify files.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["duplicate-completion-after-timeout"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"After attempt_completion times out, do not resubmit the full report; provide one short status sentence.",
		)
	})

	it("flags verification reports that contradict readable build success output", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: [
				"Running cjpm build.",
				"cjpm build success.",
				"Final result: verification inconclusive because shell integration was flaky.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["contradictory-verification-report"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"When readable output contains cjpm build success, report verification as passed, not inconclusive.",
		)
	})

	it("flags reports that claim an allowlisted command ran without a matching visible invocation", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Only run where.exe cjpm and cjpm build 2>&1.",
				"Running where.exe cjpm.",
				"Running where.exe cjpm.",
				"Command result table:",
				"where.exe cjpm\tterminal timeout",
				"cjpm build 2>&1\tterminal timeout",
				"verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["duplicate-allowlisted-command", "unverified-command-ledger"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Report only commands actually invoked; mark unavailable commands as not attempted.",
		)
	})

	it("flags Cangjie toolchain verification that runs from Desktop instead of the cjpm project", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Only run where.exe cjpm and cjpm build 2>&1.",
				"Running where.exe cjpm.",
				"Running cjpm build 2>&1.",
				"Command result table:",
				"where.exe cjpm\tC:\\Users\\Administrator\\Desktop\tok",
				"cjpm build 2>&1\tC:\\Users\\Administrator\\Desktop\tshell integration error",
				"verification inconclusive.",
			].join("\n"),
		})
		const score = scoreCangjieEvalRun(record)

		expect(record.violations).toEqual(["wrong-toolchain-working-directory"])
		expect(score.status).toBe("failed")
		expect(score.recommendedNextSteps).toContain(
			"Run Cangjie toolchain commands from the cjpm project directory, not Desktop.",
		)
	})

	it("accepts inconclusive verification when Cangjie toolchain commands run from the cjpm project", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "cjpm-toml-inline-table-error",
			text: [
				"Used real toolchain output from cjpm build.",
				"Only changed cjpm.toml with a minimal fix; no unrelated files changed.",
				"Running where.exe cjpm.",
				"Running cjpm build 2>&1.",
				"Command result table:",
				"where.exe cjpm\td:/cangjie/Cangjie-Examples/HTTP\ttimed out",
				"cjpm build 2>&1\td:/cangjie/Cangjie-Examples/HTTP\tshell integration error",
				"verification inconclusive.",
			].join("\n"),
		})

		expect(record.violations).toBeUndefined()
		expect(scoreCangjieEvalRun(record).status).toBe("passed")
	})

	it("builds a compact report from multiple eval run records", () => {
		const report = buildCangjieEvalReport([
			{
				caseId: "hello-world-project",
				observedBehaviors: ["inspect-cjpm-project", "run-cjpm-build", "minimal-edits"],
				commandsRun: ["cjpm build"],
				verificationStatus: "passed",
			},
			{
				caseId: "hashmap-usage",
				observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
				commandsRun: [],
				verificationStatus: "not-run",
			},
			{
				caseId: "missing",
				observedBehaviors: [],
				commandsRun: [],
				verificationStatus: "not-run",
			},
		])

		expect(report.totalRuns).toBe(3)
		expect(report.passed).toBe(1)
		expect(report.failed).toBe(1)
		expect(report.unknown).toBe(1)
		expect(report.failingCaseIds).toEqual(["hashmap-usage"])
		expect(report.unknownCaseIds).toEqual(["missing"])
		expect(report.scores[1]).toEqual(
			expect.objectContaining({
				caseId: "hashmap-usage",
				status: "failed",
				missingBehaviors: ["read-corpus-evidence", "run-cjpm-build"],
				missingCommands: ["cjpm build"],
			}),
		)
	})

	it("formats a mixed eval report as Markdown", () => {
		const report = buildCangjieEvalReport([
			{
				caseId: "hello-world-project",
				observedBehaviors: ["inspect-cjpm-project", "run-cjpm-build", "minimal-edits"],
				commandsRun: ["cjpm build"],
				verificationStatus: "passed",
			},
			{
				caseId: "hashmap-usage",
				observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
				commandsRun: [],
				verificationStatus: "not-run",
			},
			{
				caseId: "missing",
				observedBehaviors: [],
				commandsRun: [],
				verificationStatus: "not-run",
			},
		])

		expect(formatCangjieEvalReportMarkdown(report)).toBe(
			[
				"# Cangjie Eval Report",
				"",
				"Total runs: 3",
				"Passed: 1",
				"Failed: 1",
				"Unknown: 1",
				"",
				"## Failed Cases",
				"- hashmap-usage",
				"  - Verification: not-run",
				"  - Missing behaviors: read Cangjie corpus evidence, run cjpm build",
				"  - Missing commands: cjpm build",
				"  - Next steps: Run CangjieExplore to collect bundled Cangjie corpus evidence. Run CangjieVerify with cjpm build. Run CangjieVerify before accepting the case.",
				"",
				"## Unknown Cases",
				"- missing",
			].join("\n"),
		)
	})

	it("formats an all-pass eval report as Markdown", () => {
		const report = buildCangjieEvalReport([
			{
				caseId: "hello-world-project",
				observedBehaviors: ["inspect-cjpm-project", "run-cjpm-build", "minimal-edits"],
				commandsRun: ["cjpm build"],
				verificationStatus: "passed",
			},
		])

		expect(formatCangjieEvalReportMarkdown(report)).toContain("All evaluated Cangjie cases passed.")
	})

	it("can include human-readable case titles in Markdown reports", () => {
		const report = buildCangjieEvalReport([
			{
				caseId: "hashmap-usage",
				observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
				commandsRun: [],
				verificationStatus: "not-run",
			},
		])

		expect(formatCangjieEvalReportMarkdown(report, { includeCaseTitles: true })).toContain(
			"- hashmap-usage - Implement a small function using HashMap",
		)
		expect(formatCangjieEvalReportMarkdown(report, { language: "zh", includeCaseTitles: true })).toContain(
			"- hashmap-usage - Implement a small function using HashMap",
		)
	})

	it("formats a mixed eval report as Chinese Markdown", () => {
		const report = buildCangjieEvalReport([
			{
				caseId: "hashmap-usage",
				observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
				commandsRun: [],
				verificationStatus: "not-run",
			},
			{
				caseId: "missing",
				observedBehaviors: [],
				commandsRun: [],
				verificationStatus: "not-run",
			},
		])

		expect(formatCangjieEvalReportMarkdown(report, { language: "zh" })).toBe(
			[
				"# 仓颉评测报告",
				"",
				"运行总数：2",
				"通过：0",
				"失败：1",
				"未知：1",
				"",
				"## 失败用例",
				"- hashmap-usage",
				"  - 验证状态：未运行",
				"  - 缺失行为：读取仓颉语料证据，运行 cjpm build",
				"  - 缺失命令：cjpm build",
				"  - 下一步建议：运行 CangjieExplore 收集内置仓颉语料证据。 交给 CangjieVerify 运行 cjpm build。 验收前先运行 CangjieVerify。",
				"",
				"## 未知用例",
				"- missing",
			].join("\n"),
		)
	})

	it("evaluates observation text into records, report, and Markdown in one call", () => {
		const result = evaluateCangjieObservations([
			{
				caseId: "hashmap-usage",
				text: [
					"Read cjpm.toml and package declaration.",
					"Read relevant .cj source file under src/.",
					"Checked CangjieCorpus-1.0.0/extra/HashMap.md and libs/std/collection corpus evidence.",
					"Made a minimal edit.",
					"Ran cjpm build and build passed.",
				].join("\n"),
			},
			{
				caseId: "file-read",
				text: "Read cjpm.toml and relevant .cj source file. Made a minimal edit. Did not run cjpm build.",
			},
		])

		expect(result.runs).toHaveLength(2)
		expect(result.report.totalRuns).toBe(2)
		expect(result.report.passed).toBe(1)
		expect(result.report.failed).toBe(1)
		expect(result.report.failingCaseIds).toEqual(["file-read"])
		expect(result.markdown).toContain("# Cangjie Eval Report")
		expect(result.markdown).toContain("- file-read")
		expect(result.markdown).toContain("Missing behaviors: read Cangjie corpus evidence, run cjpm build")
		expect(result.markdown).toContain("Missing commands: cjpm build")
		expect(result.markdown).toContain("Next steps: Run CangjieExplore to collect bundled Cangjie corpus evidence.")
	})

	it("parses multiple plugin-side observation sections from Markdown", () => {
		const observations = parseCangjieEvalObservationMarkdown(
			[
				"# Manual Plugin Eval Notes",
				"",
				"## HashMap",
				"Read cjpm.toml and relevant .cj source file.",
				"Checked CangjieCorpus libs/std/collection evidence.",
				"Made a minimal edit, ran cjpm build, and build passed.",
				"",
				"## case: file-read",
				"Read cjpm.toml and relevant .cj source file.",
				"Made a minimal edit. Did not run cjpm build.",
			].join("\n"),
		)

		expect(observations).toEqual([
			{
				caseId: "hashmap-usage",
				text: [
					"Read cjpm.toml and relevant .cj source file.",
					"Checked CangjieCorpus libs/std/collection evidence.",
					"Made a minimal edit, ran cjpm build, and build passed.",
				].join("\n"),
			},
			{
				caseId: "file-read",
				text: "Read cjpm.toml and relevant .cj source file.\nMade a minimal edit. Did not run cjpm build.",
			},
		])
	})

	it("evaluates a pasted Markdown observation block in one call", () => {
		const result = evaluateCangjieObservationMarkdown(
			[
				"## hashmap-usage",
				"Read cjpm.toml and relevant .cj source file.",
				"Checked CangjieCorpus libs/std/collection evidence.",
				"Made a minimal edit, ran cjpm build, and build passed.",
				"",
				"## file-read",
				"Read cjpm.toml and relevant .cj source file.",
				"Made a minimal edit. Did not run cjpm build.",
			].join("\n"),
		)

		expect(result.runs).toHaveLength(2)
		expect(result.report.passed).toBe(1)
		expect(result.report.failed).toBe(1)
		expect(result.report.failingCaseIds).toEqual(["file-read"])
		expect(result.markdown).toContain("- file-read")
	})

	it("evaluates observations into Chinese Markdown in one call", () => {
		const result = evaluateCangjieObservations(
			[
				{
					caseId: "file-read",
					text: "读取了 cjpm.toml 和相关 .cj 源码。只修改一处，最小改动。没有运行 cjpm build。",
				},
			],
			{ language: "zh" },
		)

		expect(result.markdown).toContain("# 仓颉评测报告")
		expect(result.markdown).toContain("失败：1")
		expect(result.markdown).toContain("缺失行为：读取仓颉语料证据，运行 cjpm build")
		expect(result.markdown).toContain("下一步建议：运行 CangjieExplore 收集内置仓颉语料证据。")
	})

	it("formats eval behavior ids for human-facing reports", () => {
		expect(formatCangjieEvalBehavior("read-corpus-evidence")).toBe("read Cangjie corpus evidence")
		expect(formatCangjieEvalBehavior("read-corpus-evidence", { language: "zh" })).toBe("读取仓颉语料证据")
		expect(formatCangjieEvalBehavior("use-real-toolchain-output")).toBe("use real toolchain output")
		expect(formatCangjieEvalBehavior("record-context-injection")).toBe("record Cangjie context injection audit")
	})

	it("does not treat negated cjpm build observations as executed commands", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: "Read cjpm.toml and relevant .cj source file. Made a minimal edit. Did not run cjpm build.",
		})

		expect(record.observedBehaviors).not.toContain("run-cjpm-build")
		expect(record.commandsRun).toEqual([])
		expect(scoreCangjieEvalRun(record)).toEqual(
			expect.objectContaining({
				status: "failed",
				missingBehaviors: ["read-corpus-evidence", "run-cjpm-build"],
				missingCommands: ["cjpm build"],
			}),
		)
	})

	it("recommends next agents from missing eval gates", () => {
		const corpusAndBuildScore = scoreCangjieEvalRun({
			caseId: "hashmap-usage",
			observedBehaviors: ["inspect-cjpm-project", "read-relevant-source", "minimal-edits"],
			commandsRun: [],
			verificationStatus: "not-run",
		})
		const repairScore = scoreCangjieEvalRun({
			caseId: "mut-let-error",
			observedBehaviors: ["read-relevant-source", "run-cjpm-build"],
			commandsRun: ["cjpm build"],
			verificationStatus: "failed",
		})

		expect(corpusAndBuildScore.recommendedNextSteps).toEqual(
			expect.arrayContaining([
				"Run CangjieExplore to collect bundled Cangjie corpus evidence.",
				"Run CangjieVerify with cjpm build.",
			]),
		)
		expect(repairScore.recommendedNextSteps).toEqual(
			expect.arrayContaining([
				"Capture real cjpm/cjc/cjlint output before repair.",
				"Use CangjieRepair for a narrow 1-2 root-cause fix.",
				"Hand the failing diagnostics to CangjieRepair.",
			]),
		)
	})

	it("creates eval run records from Chinese plugin-side observations", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "hashmap-usage",
			text: [
				"读取了 cjpm.toml 和包声明。",
				"读取相关 .cj 源码。",
				"查了 CangjieCorpus 和 libs/std/collection 语料证据。",
				"只修改 HashMap 小函数，属于最小改动。",
				"运行 cjpm build，构建通过。",
			].join("\n"),
		})

		expect(record).toEqual({
			caseId: "hashmap-usage",
			observedBehaviors: [
				"inspect-cjpm-project",
				"read-relevant-source",
				"read-corpus-evidence",
				"run-cjpm-build",
				"minimal-edits",
			],
			commandsRun: ["cjpm build"],
			verificationStatus: "passed",
		})
	})

	it("does not treat Chinese negated cjpm build observations as executed commands", () => {
		const record = createCangjieEvalRunRecordFromObservation({
			caseId: "file-read",
			text: "读取了 cjpm.toml 和相关 .cj 源码。只修改一处，最小改动。没有运行 cjpm build。",
		})

		expect(record.observedBehaviors).not.toContain("run-cjpm-build")
		expect(record.commandsRun).toEqual([])
		expect(record.verificationStatus).toBe("not-run")
	})
})
