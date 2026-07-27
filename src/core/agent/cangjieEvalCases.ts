export type CangjieEvalAgentExpectation = "CangjieExplore" | "CangjieImplement" | "CangjieVerify" | "CangjieRepair"

export type CangjieEvalCategory =
	| "project-structure"
	| "entrypoint"
	| "stdlib-evidence"
	| "mutability"
	| "configuration"
	| "repair-loop"

export type CangjieEvalBehavior =
	| "inspect-cjpm-project"
	| "read-relevant-source"
	| "read-corpus-evidence"
	| "run-cjpm-build"
	| "use-real-toolchain-output"
	| "minimal-edits"
	| "no-unrelated-file-edits"
	| "allow-inconclusive-if-output-missing"
	| "report-diagnostic-progress"
	| "stop-on-stagnation"
	| "record-context-injection"

export type CangjieEvalViolation =
	| "command-allowlist-violation"
	| "duplicate-allowlisted-command"
	| "unverified-command-ledger"
	| "wrong-toolchain-working-directory"
	| "toolchain-wrapper-command"
	| "allowlist-extra-probe-narration"
	| "user-output-request"
	| "stagnant-repair-edit"
	| "unsupported-file-text-risk"
	| "unsafe-option-unwrap-guidance"
	| "invalid-option-default-call"
	| "fabricated-matchdata-default"
	| "foreign-collection-api-shape"
	| "non-raw-regex-digit-pattern"
	| "evidence-report-invites-coding"
	| "uncited-hashmap-subscript-assignment"
	| "unsupported-hashmap-mutability-claim"
	| "duplicate-completion-after-timeout"
	| "contradictory-verification-report"
	| "context-audit-missing-labels"
	| "context-audit-scope"

export type CangjieEvalCase = {
	id: string
	title: string
	category: CangjieEvalCategory
	initialProject: string
	userRequest: string
	expectedAgents: CangjieEvalAgentExpectation[]
	requiredEvidence: string[]
	verificationCommands: string[]
	passCriteria: string[]
	requiredBehaviors: CangjieEvalBehavior[]
}

export type CangjieEvalSummary = {
	totalCases: number
	casesByCategory: Record<CangjieEvalCategory, number>
	casesByAgent: Record<CangjieEvalAgentExpectation, number>
	casesByBehavior: Record<CangjieEvalBehavior, number>
	verificationCommands: string[]
	evidenceGatedCaseIds: string[]
	repairCaseIds: string[]
}

export type CangjieEvalVerificationStatus = "passed" | "failed" | "inconclusive" | "not-run"

export type CangjieEvalRunRecord = {
	caseId: string
	observedBehaviors: CangjieEvalBehavior[]
	commandsRun: string[]
	verificationStatus: CangjieEvalVerificationStatus
	violations?: CangjieEvalViolation[]
}

export type CangjieEvalRunScore = {
	caseId: string
	status: "passed" | "failed" | "unknown-case"
	missingBehaviors: CangjieEvalBehavior[]
	missingCommands: string[]
	verificationStatus: CangjieEvalVerificationStatus
	recommendedNextSteps: string[]
	violations?: CangjieEvalViolation[]
}

export type CangjieEvalReport = {
	totalRuns: number
	passed: number
	failed: number
	unknown: number
	scores: CangjieEvalRunScore[]
	failingCaseIds: string[]
	unknownCaseIds: string[]
}

export type CangjieEvalObservationInput = {
	caseId: string
	text: string
}

export type CangjieEvalObservationResult = {
	runs: CangjieEvalRunRecord[]
	report: CangjieEvalReport
	markdown: string
}

export type CangjieEvalReportLanguage = "en" | "zh"

export type CangjieEvalReportFormatOptions = {
	language?: CangjieEvalReportLanguage
	includeCaseTitles?: boolean
}

const CANGJIE_EVAL_BEHAVIOR_LABELS: Record<CangjieEvalBehavior, string> = {
	"inspect-cjpm-project": "inspect cjpm project structure",
	"read-relevant-source": "read relevant Cangjie source",
	"read-corpus-evidence": "read Cangjie corpus evidence",
	"run-cjpm-build": "run cjpm build",
	"use-real-toolchain-output": "use real toolchain output",
	"minimal-edits": "keep edits minimal",
	"no-unrelated-file-edits": "avoid unrelated file edits",
	"allow-inconclusive-if-output-missing": "report inconclusive when output is missing",
	"report-diagnostic-progress": "report diagnostic progress",
	"stop-on-stagnation": "stop editing when diagnostics stagnate",
	"record-context-injection": "record Cangjie context injection audit",
}

const CANGJIE_EVAL_BEHAVIOR_LABELS_ZH: Partial<Record<CangjieEvalBehavior, string>> = {
	"inspect-cjpm-project": "检查 cjpm 项目结构",
	"read-relevant-source": "读取相关仓颉源码",
	"read-corpus-evidence": "读取仓颉语料证据",
	"run-cjpm-build": "运行 cjpm build",
	"use-real-toolchain-output": "使用真实工具链输出",
	"minimal-edits": "保持最小改动",
	"no-unrelated-file-edits": "避免修改无关文件",
	"allow-inconclusive-if-output-missing": "输出缺失时报告验证不确定",
	"report-diagnostic-progress": "报告诊断变化",
	"stop-on-stagnation": "诊断停滞时停止继续编辑",
	"record-context-injection": "记录仓颉上下文注入审计",
}

const CANGJIE_EVAL_CONTEXT_LABELS = [
	"toolchain-rules",
	"project-overview",
	"package-declaration-check",
	"visible-editor-symbols",
	"imported-workspace-symbols",
	"stdlib-signature-hints",
	"workspace-symbol-summary",
	"import-to-corpus-doc-map",
	"compile-history",
	"recent-build-root-causes",
	"compile-repair-directive",
	"contextual-coding-rules",
	"style-few-shot",
	"diagnostics-and-fix-hints",
	"intent-matched-corpus-extra",
	"auto-corpus-search-results",
	"cjpm-tree",
	"structured-editing-context",
	"learned-fixes",
	"mandatory-corpus-footer",
] as const

const CANGJIE_EVAL_CONTEXT_AUDIT_SCOPE_EXTRA_HEADINGS = [
	"project status",
	"directory tree",
	"source files:",
	"source-file list",
	"current symbols:",
	"current editing context",
	"package structure",
	"项目状态",
	"当前项目状态",
	"目录结构",
	"源文件",
	"源文件清单",
	"当前编辑上下文",
	"符号",
	"符号定义",
	"包结构",
	"椤圭洰鐘舵",
	"鐩綍缁撴瀯",
	"婧愭枃浠舵竻鍗",
	"褰撳墠缂栬緫涓婁笅鏂囪",
] as const
const CANGJIE_EVAL_CONTEXT_NEGATED_SCOPE_STATUS_RE =
	/(?:未|没有|无需|不)(?:读取|查看|分析|展开|列出|修改)[^。\n]*(?:项目状态|当前项目状态|目录结构|源文件|源文件清单|当前编辑上下文|符号|符号定义|包结构|project status|directory tree|source files?|source-file list|current symbols?|current editing context|package structure)[^。\n]*(?:。|\n|$)/gi

export const CANGJIE_EVAL_CASES: CangjieEvalCase[] = [
	{
		id: "hello-world-project",
		title: "Create or complete a minimal hello world cjpm project",
		category: "project-structure",
		initialProject: "Empty directory or partially initialized cjpm project",
		userRequest: "Create a minimal Cangjie hello world program that builds.",
		expectedAgents: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		requiredEvidence: ["cjpm.toml project layout", "src-dir/package declaration relationship"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Creates files under the cjpm source directory",
			"Uses the correct package declaration",
			"Build passes",
		],
		requiredBehaviors: ["inspect-cjpm-project", "run-cjpm-build", "minimal-edits"],
	},
	{
		id: "package-mismatch",
		title: "Repair a package declaration that does not match the file path",
		category: "project-structure",
		initialProject: "cjpm project with src/foo/bar.cj declaring the wrong package",
		userRequest: "Fix the package error reported by the compiler.",
		expectedAgents: ["CangjieExplore", "CangjieRepair", "CangjieVerify"],
		requiredEvidence: ["cjpm.toml src-dir", "file path to package mapping", "real toolchain diagnostic"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Changes only the package declaration or directly related config",
			"Does not rewrite business logic",
			"Build passes",
		],
		requiredBehaviors: [
			"inspect-cjpm-project",
			"read-relevant-source",
			"use-real-toolchain-output",
			"run-cjpm-build",
			"minimal-edits",
			"no-unrelated-file-edits",
		],
	},
	{
		id: "main-signature-error",
		title: "Repair an invalid main function signature",
		category: "entrypoint",
		initialProject: "Executable cjpm project with an invalid main signature or missing return",
		userRequest: "Fix main so the project compiles.",
		expectedAgents: ["CangjieRepair", "CangjieVerify"],
		requiredEvidence: ["real cjpm/cjc diagnostic", "current executable package source"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Fixes only the entrypoint signature/return issue",
			"Preserves existing behavior",
			"Build passes",
		],
		requiredBehaviors: ["read-relevant-source", "use-real-toolchain-output", "run-cjpm-build", "minimal-edits"],
	},
	{
		id: "arraylist-usage",
		title: "Implement a small function using ArrayList",
		category: "stdlib-evidence",
		initialProject: "cjpm project without existing ArrayList usage",
		userRequest: "Add a small ArrayList helper function.",
		expectedAgents: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		requiredEvidence: ["CangjieCorpus-1.0.0/extra/ArrayList.md", "libs/std/collection ArrayList API or sample"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Reads collection evidence before adding std.collection usage",
			"Uses mutability correctly",
			"Build passes",
		],
		requiredBehaviors: [
			"inspect-cjpm-project",
			"read-relevant-source",
			"read-corpus-evidence",
			"run-cjpm-build",
			"minimal-edits",
		],
	},
	{
		id: "hashmap-usage",
		title: "Implement a small function using HashMap",
		category: "stdlib-evidence",
		initialProject: "cjpm project without existing HashMap usage",
		userRequest: "Add a HashMap helper that counts string occurrences.",
		expectedAgents: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		requiredEvidence: ["CangjieCorpus-1.0.0/extra/HashMap.md", "libs/std/collection HashMap API or sample"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Checks HashMap key constraints and Option-returning APIs",
			"Uses a verified std.collection import",
			"Build passes",
		],
		requiredBehaviors: [
			"inspect-cjpm-project",
			"read-relevant-source",
			"read-corpus-evidence",
			"run-cjpm-build",
			"minimal-edits",
		],
	},
	{
		id: "file-read",
		title: "Implement a small file read helper",
		category: "stdlib-evidence",
		initialProject: "cjpm project with no file API usage",
		userRequest: "Add a helper that reads a text file.",
		expectedAgents: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		requiredEvidence: ["libs/std/fs or matching file API docs", "project import style"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Reads file API evidence before importing std.fs",
			"Handles documented return/error behavior",
			"Build passes",
		],
		requiredBehaviors: [
			"inspect-cjpm-project",
			"read-relevant-source",
			"read-corpus-evidence",
			"run-cjpm-build",
			"minimal-edits",
		],
	},
	{
		id: "regex-match",
		title: "Implement a small regex match helper",
		category: "stdlib-evidence",
		initialProject: "cjpm project with no regex API usage",
		userRequest: "Add a helper that checks whether text matches a pattern.",
		expectedAgents: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		requiredEvidence: ["regex standard library or corpus docs", "current package/import style"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Reads regex API evidence before implementation",
			"Does not borrow another language's regex API shape",
			"Build passes",
		],
		requiredBehaviors: [
			"inspect-cjpm-project",
			"read-relevant-source",
			"read-corpus-evidence",
			"run-cjpm-build",
			"minimal-edits",
		],
	},
	{
		id: "mut-let-error",
		title: "Repair a let/var mutability error",
		category: "mutability",
		initialProject: "cjpm project where a mutating call is made through an immutable binding",
		userRequest: "Fix the mutability compile error.",
		expectedAgents: ["CangjieRepair", "CangjieVerify"],
		requiredEvidence: ["real compiler diagnostic", "directly implicated source file"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Changes the binding or call site narrowly",
			"Does not change unrelated data flow",
			"Build passes",
		],
		requiredBehaviors: [
			"read-relevant-source",
			"use-real-toolchain-output",
			"run-cjpm-build",
			"minimal-edits",
			"no-unrelated-file-edits",
		],
	},
	{
		id: "cjpm-toml-inline-table-error",
		title: "Repair a cjpm.toml inline table extension error",
		category: "configuration",
		initialProject: "cjpm project with package-configuration = {} plus nested package-configuration tables",
		userRequest: "Fix the cjpm.toml parse error.",
		expectedAgents: ["CangjieRepair", "CangjieVerify"],
		requiredEvidence: ["real cjpm parse error", "cjpm.toml only"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Edits only the conflicting TOML entry",
			"Does not inspect or rewrite unrelated source",
			"Verification is pass or explicitly inconclusive if output is unavailable",
		],
		requiredBehaviors: [
			"use-real-toolchain-output",
			"run-cjpm-build",
			"minimal-edits",
			"no-unrelated-file-edits",
			"allow-inconclusive-if-output-missing",
		],
	},
	{
		id: "build-failure-repair-loop",
		title: "Repair after build failure in small steps",
		category: "repair-loop",
		initialProject: "cjpm project with multiple compiler errors",
		userRequest: "Make the build pass.",
		expectedAgents: ["CangjieVerify", "CangjieRepair", "CangjieVerify"],
		requiredEvidence: ["real toolchain output", "top 1-2 root causes", "post-repair verification output"],
		verificationCommands: ["cjpm build"],
		passCriteria: [
			"Repairs only the top 1-2 root causes per round",
			"Reports whether diagnostics improved",
			"Stops for evidence if failures stagnate",
		],
		requiredBehaviors: [
			"read-relevant-source",
			"use-real-toolchain-output",
			"run-cjpm-build",
			"minimal-edits",
			"report-diagnostic-progress",
			"stop-on-stagnation",
			"record-context-injection",
		],
	},
]

const CANGJIE_EVAL_CASE_ALIASES: Record<string, string> = {
	"hello world": "hello-world-project",
	hello: "hello-world-project",
	"package mismatch": "package-mismatch",
	"main signature": "main-signature-error",
	entrypoint: "main-signature-error",
	arraylist: "arraylist-usage",
	hashmap: "hashmap-usage",
	"hash map": "hashmap-usage",
	"file read": "file-read",
	regex: "regex-match",
	"regex match": "regex-match",
	mutability: "mut-let-error",
	"mut let": "mut-let-error",
	"let var": "mut-let-error",
	"inline table": "cjpm-toml-inline-table-error",
	"repair loop": "build-failure-repair-loop",
	"build failure": "build-failure-repair-loop",
}

export function getCangjieEvalCase(id: string): CangjieEvalCase | undefined {
	return CANGJIE_EVAL_CASES.find((testCase) => testCase.id === id)
}

export function resolveCangjieEvalCaseId(text: string): string | undefined {
	const normalized = normalizeCangjieEvalCaseText(text)
	if (getCangjieEvalCase(normalized)) {
		return normalized
	}

	const explicitCase = normalized.match(/(?:case|case id|eval case)\s*[:=]\s*([a-z0-9-]+)/)?.[1]
	if (explicitCase && getCangjieEvalCase(explicitCase)) {
		return explicitCase
	}

	if (/return type of ['"`]?main['"`]?|main\s*(?:函数)?\s*(?:签名|返回类型)/i.test(normalized)) {
		return "main-signature-error"
	}
	if (/\bhashmap\b|\bcountstrings\b|\bcountwords\b/i.test(normalized)) {
		return "hashmap-usage"
	}
	if (/\barraylist\b|\bduplicatestrings\b/i.test(normalized)) {
		return "arraylist-usage"
	}
	if (/\breadtextfile\b|\bfile\.readfrom\b|\bstd\.fs\b|\bfile read\b/i.test(normalized)) {
		return "file-read"
	}
	if (
		/\binline table\b/i.test(normalized) ||
		/(?:cjpm\.toml.{0,40}(?:parse|解析|内联表)|(?:parse|解析|内联表).{0,40}cjpm\.toml)/i.test(normalized)
	) {
		return "cjpm-toml-inline-table-error"
	}

	const directMatch = CANGJIE_EVAL_CASES.find(
		(testCase) => normalized === testCase.id || normalized.includes(testCase.id),
	)
	if (directMatch) {
		return directMatch.id
	}

	const aliasMatch = Object.entries(CANGJIE_EVAL_CASE_ALIASES).find(
		([alias]) => normalized === alias || normalized.includes(alias),
	)
	return aliasMatch?.[1]
}

export function summarizeCangjieEvalCases(testCases: CangjieEvalCase[] = CANGJIE_EVAL_CASES): CangjieEvalSummary {
	const casesByCategory = createZeroedRecord<CangjieEvalCategory>([
		"project-structure",
		"entrypoint",
		"stdlib-evidence",
		"mutability",
		"configuration",
		"repair-loop",
	])
	const casesByAgent = createZeroedRecord<CangjieEvalAgentExpectation>([
		"CangjieExplore",
		"CangjieImplement",
		"CangjieVerify",
		"CangjieRepair",
	])
	const casesByBehavior = createZeroedRecord<CangjieEvalBehavior>([
		"inspect-cjpm-project",
		"read-relevant-source",
		"read-corpus-evidence",
		"run-cjpm-build",
		"use-real-toolchain-output",
		"minimal-edits",
		"no-unrelated-file-edits",
		"allow-inconclusive-if-output-missing",
		"report-diagnostic-progress",
		"stop-on-stagnation",
		"record-context-injection",
	])
	const verificationCommands = new Set<string>()
	const evidenceGatedCaseIds: string[] = []
	const repairCaseIds: string[] = []

	for (const testCase of testCases) {
		casesByCategory[testCase.category] += 1
		for (const agent of new Set(testCase.expectedAgents)) {
			casesByAgent[agent] += 1
		}
		for (const behavior of new Set(testCase.requiredBehaviors)) {
			casesByBehavior[behavior] += 1
		}
		for (const command of testCase.verificationCommands) {
			verificationCommands.add(command)
		}
		if (testCase.category === "stdlib-evidence") {
			evidenceGatedCaseIds.push(testCase.id)
		}
		if (testCase.expectedAgents.includes("CangjieRepair")) {
			repairCaseIds.push(testCase.id)
		}
	}

	return {
		totalCases: testCases.length,
		casesByCategory,
		casesByAgent,
		casesByBehavior,
		verificationCommands: [...verificationCommands].sort(),
		evidenceGatedCaseIds,
		repairCaseIds,
	}
}

export function scoreCangjieEvalRun(run: CangjieEvalRunRecord): CangjieEvalRunScore {
	const testCase = getCangjieEvalCase(run.caseId)

	if (!testCase) {
		return {
			caseId: run.caseId,
			status: "unknown-case",
			missingBehaviors: [],
			missingCommands: [],
			verificationStatus: run.verificationStatus,
			recommendedNextSteps: ["Check the case id against CANGJIE_EVAL_CASES."],
		}
	}

	const observedBehaviors = new Set(run.observedBehaviors)
	const commandsRun = new Set(run.commandsRun)
	const violations = run.violations ?? []
	const missingBehaviors = testCase.requiredBehaviors.filter((behavior) => !observedBehaviors.has(behavior))
	const missingCommands = testCase.verificationCommands.filter((command) => !commandsRun.has(command))
	const verificationAccepted =
		run.verificationStatus === "passed" ||
		(run.verificationStatus === "inconclusive" &&
			testCase.requiredBehaviors.includes("allow-inconclusive-if-output-missing"))

	const score: CangjieEvalRunScore = {
		caseId: testCase.id,
		status:
			missingBehaviors.length === 0 &&
			missingCommands.length === 0 &&
			verificationAccepted &&
			violations.length === 0
				? "passed"
				: "failed",
		missingBehaviors,
		missingCommands,
		verificationStatus: run.verificationStatus,
		recommendedNextSteps: recommendCangjieEvalNextSteps(
			missingBehaviors,
			missingCommands,
			run.verificationStatus,
			violations,
		),
	}
	if (violations.length > 0) {
		score.violations = violations
	}
	return score
}

export function buildCangjieEvalReport(runs: CangjieEvalRunRecord[]): CangjieEvalReport {
	const scores = runs.map((run) => scoreCangjieEvalRun(run))
	const failingCaseIds = scores.filter((score) => score.status === "failed").map((score) => score.caseId)
	const unknownCaseIds = scores.filter((score) => score.status === "unknown-case").map((score) => score.caseId)

	return {
		totalRuns: runs.length,
		passed: scores.filter((score) => score.status === "passed").length,
		failed: failingCaseIds.length,
		unknown: unknownCaseIds.length,
		scores,
		failingCaseIds,
		unknownCaseIds,
	}
}

export function formatCangjieEvalReportMarkdown(
	report: CangjieEvalReport,
	options: CangjieEvalReportFormatOptions = {},
): string {
	const language = options.language ?? "en"
	if (language === "zh") {
		return formatCangjieEvalReportMarkdownZh(report, options)
	}

	const lines = [
		"# Cangjie Eval Report",
		"",
		`Total runs: ${report.totalRuns}`,
		`Passed: ${report.passed}`,
		`Failed: ${report.failed}`,
		`Unknown: ${report.unknown}`,
	]
	const failingScores = report.scores.filter((score) => score.status === "failed")
	const unknownScores = report.scores.filter((score) => score.status === "unknown-case")

	if (failingScores.length > 0) {
		lines.push("", "## Failed Cases")
		for (const score of failingScores) {
			lines.push(`- ${formatCangjieEvalCaseReportLabel(score.caseId, options)}`)
			lines.push(`  - Verification: ${score.verificationStatus}`)
			if (score.missingBehaviors.length > 0) {
				lines.push(
					`  - Missing behaviors: ${score.missingBehaviors.map((behavior) => formatCangjieEvalBehavior(behavior)).join(", ")}`,
				)
			}
			if (score.missingCommands.length > 0) {
				lines.push(`  - Missing commands: ${score.missingCommands.join(", ")}`)
			}
			if (score.violations && score.violations.length > 0) {
				lines.push(`  - Violations: ${score.violations.join(", ")}`)
			}
			if (score.recommendedNextSteps.length > 0) {
				lines.push(`  - Next steps: ${score.recommendedNextSteps.join(" ")}`)
			}
		}
	}

	if (unknownScores.length > 0) {
		lines.push("", "## Unknown Cases")
		for (const score of unknownScores) {
			lines.push(`- ${formatCangjieEvalCaseReportLabel(score.caseId, options)}`)
		}
	}

	if (failingScores.length === 0 && unknownScores.length === 0) {
		lines.push("", "All evaluated Cangjie cases passed.")
	}

	return lines.join("\n")
}

function formatCangjieEvalCaseReportLabel(caseId: string, options: CangjieEvalReportFormatOptions): string {
	if (!options.includeCaseTitles) {
		return caseId
	}
	const testCase = getCangjieEvalCase(caseId)
	return testCase ? `${caseId} - ${testCase.title}` : caseId
}

export function formatCangjieEvalBehavior(
	behavior: CangjieEvalBehavior,
	options: CangjieEvalReportFormatOptions = {},
): string {
	return options.language === "zh"
		? (CANGJIE_EVAL_BEHAVIOR_LABELS_ZH[behavior] ?? CANGJIE_EVAL_BEHAVIOR_LABELS[behavior])
		: CANGJIE_EVAL_BEHAVIOR_LABELS[behavior]
}

export function evaluateCangjieObservations(
	inputs: CangjieEvalObservationInput[],
	options: CangjieEvalReportFormatOptions = {},
): CangjieEvalObservationResult {
	const runs = inputs.map((input) => createCangjieEvalRunRecordFromObservation(input))
	const report = buildCangjieEvalReport(runs)

	return {
		runs,
		report,
		markdown: formatCangjieEvalReportMarkdown(report, options),
	}
}

export function parseCangjieEvalObservationMarkdown(text: string): CangjieEvalObservationInput[] {
	const inputs: CangjieEvalObservationInput[] = []
	let currentCaseId: string | undefined
	let currentLines: string[] = []

	const flushCurrent = () => {
		if (!currentCaseId) {
			return
		}
		const observationText = currentLines.join("\n").trim()
		if (observationText.length > 0) {
			inputs.push({
				caseId: currentCaseId,
				text: observationText,
			})
		}
	}

	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		const caseId = extractCangjieEvalCaseIdFromLine(line)
		if (caseId) {
			flushCurrent()
			currentCaseId = caseId
			currentLines = []
			continue
		}
		if (currentCaseId) {
			currentLines.push(line)
		}
	}

	flushCurrent()
	return inputs
}

export function evaluateCangjieObservationMarkdown(
	text: string,
	options: CangjieEvalReportFormatOptions = {},
): CangjieEvalObservationResult {
	return evaluateCangjieObservations(parseCangjieEvalObservationMarkdown(text), options)
}

export function createCangjieEvalRunRecordFromObservation(input: CangjieEvalObservationInput): CangjieEvalRunRecord {
	const normalized = input.text.toLowerCase()
	const observedBehaviors = new Set<CangjieEvalBehavior>()
	const commandsRun = new Set<string>()

	if (
		matchesAny(normalized, [
			"cjpm.toml",
			"src-dir",
			"package layout",
			"project structure",
			"package declaration",
			"椤圭洰缁撴瀯",
			"鍖呭０鏄?",
			"包声明",
			"读取了 cjpm.toml",
			"璇诲彇浜?cjpm.toml",
			"璇诲彇 cjpm.toml",
		])
	) {
		observedBehaviors.add("inspect-cjpm-project")
	}
	if (
		matchesAny(normalized, [
			"read source",
			".cj",
			"src/",
			"source file",
			"relevant file",
			"directly implicated",
			"璇诲彇婧愮爜",
			"璇诲彇婧愭枃浠?",
			"鐩稿叧婧愮爜",
			"鐩稿叧 .cj",
			"鐩存帴鐩稿叧鏂囦欢",
			"读取相关 .cj 源码",
			"相关 .cj 源码",
		])
	) {
		observedBehaviors.add("read-relevant-source")
	}
	if (
		matchesAny(normalized, [
			"cangjiecorpus",
			"libs/std",
			"extra/hashmap.md",
			"extra/arraylist.md",
			"corpus evidence",
			"璇枡",
			"璇枡璇佹嵁",
			"鏌ヤ簡 cangjiecorpus",
			"璇诲彇 cangjiecorpus",
		])
	) {
		observedBehaviors.add("read-corpus-evidence")
	}
	if (matchesAny(normalized, ["cjpm build"]) && !hasNegatedCommand(normalized, "cjpm build")) {
		observedBehaviors.add("run-cjpm-build")
		commandsRun.add("cjpm build")
	}
	if (
		matchesAny(normalized, [
			"real toolchain",
			"compiler diagnostic",
			"cjpm parse error",
			"cjpm build failed",
			"cjc diagnostic",
			"鐪熷疄宸ュ叿閾?",
			"缂栬瘧鍣ㄨ瘖鏂?",
			"缂栬瘧閿欒",
			"鏋勫缓澶辫触",
			"cjpm 瑙ｆ瀽閿欒",
		])
	) {
		observedBehaviors.add("use-real-toolchain-output")
	}
	if (
		matchesAny(normalized, [
			"minimal edit",
			"minimal fix",
			"only changed",
			"small-step",
			"small step",
			"localized edit",
			"鏈€灏忔敼鍔?",
			"鍙慨鏀?",
			"灏忔",
			"灞€閮ㄤ慨鏀?",
			"只修改",
			"最小改动",
		])
	) {
		observedBehaviors.add("minimal-edits")
	}
	if (
		matchesAny(normalized, [
			"no unrelated",
			"did not inspect unrelated",
			"did not rewrite unrelated",
			"unrelated files unchanged",
			"娌℃湁淇敼鏃犲叧",
			"鏈慨鏀规棤鍏?",
			"涓嶆敼鏃犲叧",
			"鏃犲叧鏂囦欢鏈彉",
		])
	) {
		observedBehaviors.add("no-unrelated-file-edits")
	}
	if (
		matchesAny(normalized, [
			"verification inconclusive",
			"inconclusive",
			"unable to capture output",
			"output unavailable",
			"鏃犳硶鑾峰彇杈撳嚭",
			"鏃犳硶鎹曡幏杈撳嚭",
			"鎷夸笉鍒拌緭鍑?",
			"楠岃瘉涓嶇‘瀹?",
			"楠岃瘉缁撴灉涓嶇‘瀹?",
		])
	) {
		observedBehaviors.add("allow-inconclusive-if-output-missing")
	}
	if (
		matchesAny(normalized, [
			"diagnostics improved",
			"diagnostic progress",
			"errors decreased",
			"errors did not improve",
			"璇婃柇鏀瑰杽",
			"閿欒鍑忓皯",
			"閿欒娌℃湁鏀瑰杽",
			"閿欒鏈敼鍠?",
		])
	) {
		observedBehaviors.add("report-diagnostic-progress")
	}
	if (
		matchesAny(normalized, [
			"stop on stagnation",
			"stagnant",
			"failures stagnate",
			"stop editing",
			"鍋滄粸",
			"鍋滄缂栬緫",
			"鍋滄淇敼",
			"鍏堟煡璇佹嵁",
		])
	) {
		observedBehaviors.add("stop-on-stagnation")
	}
	if (
		matchesAny(normalized, [
			"cangjie context injection audit",
			"context injection audit",
			"injected context",
			"context sources influenced",
			"toolchain-rules",
			"project-overview",
			"stdlib-signature-hints",
			"compile-history",
		])
	) {
		observedBehaviors.add("record-context-injection")
	}

	const run: CangjieEvalRunRecord = {
		caseId: input.caseId,
		observedBehaviors: [...observedBehaviors],
		commandsRun: [...commandsRun],
		verificationStatus: inferVerificationStatus(normalized),
	}
	const violations = inferCangjieEvalViolations(normalized)
	if (violations) {
		run.violations = violations
	}
	return run
}

function createZeroedRecord<K extends string>(keys: K[]): Record<K, number> {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

function inferVerificationStatus(normalizedText: string): CangjieEvalVerificationStatus {
	if (
		matchesAny(normalizedText, [
			"verification inconclusive",
			"inconclusive",
			"unable to capture output",
			"output unavailable",
		])
	) {
		return "inconclusive"
	}
	if (
		matchesAny(normalizedText, [
			"build passes",
			"build passed",
			"verification passed",
			"compiled successfully",
			"鏋勫缓閫氳繃",
			"缂栬瘧閫氳繃",
			"楠岃瘉閫氳繃",
			"构建通过",
			"编译通过",
		])
	) {
		return "passed"
	}
	if (
		matchesAny(normalizedText, [
			"build failed",
			"verification failed",
			"compiler error",
			"cjpm build failed",
			"鏋勫缓澶辫触",
			"缂栬瘧澶辫触",
			"楠岃瘉澶辫触",
			"缂栬瘧閿欒",
		])
	) {
		return "failed"
	}
	return "not-run"
}

function inferCangjieEvalViolations(normalizedText: string): CangjieEvalViolation[] | undefined {
	const violations = new Set<CangjieEvalViolation>()
	if (
		matchesAny(normalizedText, ["explicit command allowlist", "only run", "only ran", "鍙繍琛?", "鍙墽琛?"]) &&
		matchesAny(normalizedText, [
			"another way",
			"alternate shell",
			"fallback command",
			"rewritten command",
			"cd /d",
			"get-command cjpm",
			"powershell",
			"powershell -command",
			"powershell.exe -command",
			"灏濊瘯鐢ㄥ彟涓€绉嶆柟寮?",
			"鎹竴绉嶆柟寮?",
		])
	) {
		violations.add("command-allowlist-violation")
	}
	if (
		matchesAny(normalizedText, ["only run", "only ran"]) &&
		countCommandInvocationLines(normalizedText, "where.exe cjpm") > 1
	) {
		violations.add("duplicate-allowlisted-command")
	}
	if (
		matchesAny(normalizedText, ["only run", "only ran"]) &&
		matchesAny(normalizedText, [
			"cjpm build 2>&1\t",
			"cjpm build 2>&1 timed out",
			"cjpm build 2>&1: timed out",
			"cjpm build 2>&1 鈥?timeout",
			"cjpm build 2>&1 鈥?shell",
			"cjpm build 2>&1\tterminal",
			"cjpm build 2>&1 缁堢",
			"cjpm build 2>&1 瓒呮椂",
		]) &&
		!matchesAny(normalizedText, [
			"running cjpm build 2>&1",
			"姝ｅ湪杩愯\ncjpm build 2>&1",
			"姝ｅ湪杩愯 cjpm build 2>&1",
		])
	) {
		violations.add("unverified-command-ledger")
	}
	if (reportsCangjieToolchainFromDesktop(normalizedText)) {
		violations.add("wrong-toolchain-working-directory")
	}
	if (usesWrappedCangjieToolchainCommand(normalizedText)) {
		violations.add("toolchain-wrapper-command")
	}
	if (
		matchesAny(normalizedText, ["only run", "only ran"]) &&
		matchesAny(normalizedText, [
			"check current directory",
			"checking current directory",
			"check whether cjpm.toml exists",
			"confirm project exists",
			"confirming project exists",
			"鍏堟鏌ュ綋鍓嶇洰褰?",
			"妫€鏌ュ綋鍓嶇洰褰曚笅鏄惁鏈?cjpm.toml",
			"纭宸ョ▼瀛樺湪",
			"纭椤圭洰瀛樺湪",
		])
	) {
		violations.add("allowlist-extra-probe-narration")
	}
	if (
		matchesAny(normalizedText, [
			"paste terminal output",
			"copy terminal output",
			"paste the build output",
			"copy the build output",
			"终端中的构建输出复制粘贴",
			"复制粘贴给我",
			"粘贴给我",
			"灏嗙粓绔腑鐨勬瀯寤鸿緭鍑哄鍒?",
			"绮樿创缁欐垜",
			"澶嶅埗绮樿创缁欐垜",
			"鎵嬪姩杩愯 cjpm build 骞跺憡璇?",
			"鎵嬪姩鎵ц cjpm build",
			"鎵嬪姩鍦ㄧ粓绔墽琛?cjpm build",
			"manually run cjpm build",
		])
	) {
		violations.add("user-output-request")
	}
	if (
		matchesAny(normalizedText, [
			"diagnostics did not improve",
			"errors did not improve",
			"non-decreasing error count",
			"stagnant",
			"failures stagnate",
			"璇婃柇鍋滄粸",
			"閿欒娌℃湁鏀瑰杽",
			"閿欒鏈敼鍠?",
		]) &&
		matchesAny(normalizedText, [
			"continue editing",
			"continued editing",
			"continue modifying",
			"write_to_file",
			"apply_patch",
			"applying edit",
			"modified src/",
			"edited src/",
			"缁х画缂栬緫",
			"缁х画淇敼",
			"缁х画鍐欏叆",
			"鐩存帴淇敼",
		]) &&
		!matchesAny(normalizedText, [
			"stop editing",
			"stop blind edits",
			"blocked",
			"not applied",
			"鍋滄缂栬緫",
			"鍋滄淇敼",
			"鎷︽埅",
			"鏈簲鐢?",
		])
	) {
		violations.add("stagnant-repair-edit")
	}
	if (reportsUnsupportedFileTextRisk(normalizedText)) {
		violations.add("unsupported-file-text-risk")
	}
	if (reportsUnsafeOptionUnwrapGuidance(normalizedText)) {
		violations.add("unsafe-option-unwrap-guidance")
	}
	if (reportsInvalidOptionDefaultCall(normalizedText)) {
		violations.add("invalid-option-default-call")
	}
	if (reportsFabricatedMatchDataDefault(normalizedText)) {
		violations.add("fabricated-matchdata-default")
	}
	if (reportsForeignCollectionApiShape(normalizedText)) {
		violations.add("foreign-collection-api-shape")
	}
	if (reportsNonRawRegexDigitPattern(normalizedText)) {
		violations.add("non-raw-regex-digit-pattern")
	}
	if (reportsEvidenceReportInvitesCoding(normalizedText)) {
		violations.add("evidence-report-invites-coding")
	}
	if (reportsUncitedHashMapSubscriptAssignment(normalizedText)) {
		violations.add("uncited-hashmap-subscript-assignment")
	}
	if (reportsUnsupportedHashMapMutabilityClaim(normalizedText)) {
		violations.add("unsupported-hashmap-mutability-claim")
	}
	if (reportsContextAuditMissingLabels(normalizedText)) {
		violations.add("context-audit-missing-labels")
	}
	if (reportsContextAuditScope(normalizedText)) {
		violations.add("context-audit-scope")
	}
	if (reportsDuplicateCompletionAfterTimeout(normalizedText)) {
		violations.add("duplicate-completion-after-timeout")
	}
	if (
		matchesAny(normalizedText, ["cjpm build success", "build success", "缂栬瘧鎴愬姛", "缂栬瘧閫氳繃"]) &&
		matchesAny(normalizedText, ["verification inconclusive", "unable to confirm", "unable to determine"])
	) {
		violations.add("contradictory-verification-report")
	}
	return violations.size > 0 ? [...violations] : undefined
}

function countCangjieContextLabels(normalizedText: string): number {
	return CANGJIE_EVAL_CONTEXT_LABELS.reduce((count, label) => {
		return normalizedText.includes(label) ? count + 1 : count
	}, 0)
}

function reportsContextInjectionAudit(normalizedText: string): boolean {
	return matchesAny(normalizedText, [
		"cangjie context injection audit",
		"context injection audit",
		"context injection list",
		"injected context",
	])
}

function reportsContextAuditMissingLabels(normalizedText: string): boolean {
	return reportsContextInjectionAudit(normalizedText) && countCangjieContextLabels(normalizedText) < 3
}

function reportsContextAuditScope(normalizedText: string): boolean {
	if (!reportsContextInjectionAudit(normalizedText) && countCangjieContextLabels(normalizedText) < 3) {
		return false
	}
	const scopeText = normalizedText.replace(CANGJIE_EVAL_CONTEXT_NEGATED_SCOPE_STATUS_RE, "")
	return CANGJIE_EVAL_CONTEXT_AUDIT_SCOPE_EXTRA_HEADINGS.some((heading) => scopeText.includes(heading))
}

function reportsEvidenceReportInvitesCoding(normalizedText: string): boolean {
	const evidenceOnlyReport =
		matchesAny(normalizedText, [
			"cangjie evidence audit",
			"evidence collected",
			"evidence report",
			"investigation report",
			"璇佹嵁鏀堕泦",
			"璋冩煡鎶ュ憡",
		]) &&
		matchesAny(normalizedText, [
			"no files were modified",
			"without modifying files",
			"did not modify files",
			"鏈慨鏀逛换浣曟枃浠?",
			"鏈慨鏀规枃浠?",
		])
	if (!evidenceOnlyReport) return false
	return matchesAny(normalizedText, [
		"tell me if you want",
		"if you want implementation",
		"if you confirm",
		"waiting for user instruction",
		"awaiting user instruction",
		"should i continue",
		"璇峰憡璇夋垜",
		"濡傞渶寮€濮嬬紪鍐欎唬鐮?",
		"濡傛灉闇€瑕佹垜鍙互",
		"绛夊緟鐢ㄦ埛鎸囦护",
		"绛夊緟鎸囦护",
		"鏄惁缁х画",
	])
}

const NORMAL_HASHMAP_MUTABILITY_CLAIM_RE =
	/(?:add\s*(?:\u662f|\u4e3a)\s*mut|add[\s\S]{0,80}(?:\u5fc5\u987b|\u9700\u8981)[\s\S]{0,40}var|hashmap[\s\S]{0,80}(?:\u53d8\u91cf|\u5b9e\u4f8b)?[\s\S]{0,40}(?:\u5fc5\u987b|\u9700\u8981|\u8981\u6c42)[\s\S]{0,40}var|\u5fc5\u987b[\s\S]{0,40}var|\u4e0d\u80fd[\s\S]{0,80}let|let[\s\S]{0,160}(?:\u5373\u53ef|\u8db3\u591f|\u53ef\u4ee5|\u53ef\u8c03|\u4e5f\u53ef\u884c|\u4e5f\u53ef\u4ee5)[\s\S]{0,100}add|let[\s\S]{0,120}(?:\u63a8\u8350|\u66f4\u7b80\u6d01)|\u4e0d\u9700\u8981\s*var|var[\s\S]{0,40}(?:\u4e0d\u5fc5\u8981|\u53ef\u9009))/i

function reportsUnsupportedHashMapMutabilityClaim(normalizedText: string): boolean {
	if (/\barraylist\b/i.test(normalizedText) && !/(?:\bhashmap\b|\b(?:map|counts)\.add\s*\()/i.test(normalizedText)) {
		return false
	}
	if (!matchesAny(normalizedText, ["hashmap", "map.add", "counts.add", "add("])) return false
	const claimsVarRequired =
		/\badd\b[\s\S]{0,120}\bmut\s+(?:method|func|function)\b/i.test(normalizedText) ||
		/\bhashmap\.add\b[\s\S]{0,160}\brequires\s+var\b/i.test(normalizedText) ||
		/\b(?:must|cannot|can't)\b[\s\S]{0,120}\b(?:var|let)\b[\s\S]{0,120}\bhashmap\.add\b/i.test(normalizedText) ||
		matchesAny(normalizedText, [
			"add 鏄?mut",
			"add 涓?mut",
			"add 鏂规硶瑕佹眰瀹炰緥涓?var",
			"add 鏂规硶闇€瑕?var",
			"add 蹇呴』閫氳繃 var",
			"add 蹇呴』鐢?var",
			"HashMap 鍙橀噺蹇呴』鐢?var",
			"蹇呴』鐢?var 澹版槑",
			"蹇呴』閫氳繃 var 缁戝畾",
			"瑕佹眰鍙橀噺缁戝畾涓?var",
			"淇敼鎿嶄綔瑕佹眰鍙橀噺缁戝畾涓?var",
			"鍙互鏂█ var 鏄繀闇€",
			"鍙互鏂█锛歛dd 蹇呴』 var",
			"蹇呴』浣跨敤 var",
			"涓嶈兘浣跨敤 let",
			"涓嶈兘鐢?let",
			"閸欐禒銉︽焽鐟封偓 var",
			"var 閺勵垰绻€闂団偓",
			"韫囧懘銆?var",
		])
	const claimsLetValidOrPreferred =
		/\blet\s+(?:map|counts)\s*=\s*hashmap[\s\S]{0,240}(?:map|counts)\.(?:add|remove|clear)\s*\(/i.test(
			normalizedText,
		) ||
		matchesAny(normalizedText, [
			"let 缁戝畾涓嶅彲鍙樺紩鐢ㄤ絾鍙互璋冪敤",
			"let 鍙皟 add",
			"let 鍙互璋冪敤 add",
			"let 灏辫冻澶?",
			"let 瓒冲",
			"let 涔熷彲",
			"let 涔熷彲浠?",
			"let 涔熷彲琛?",
			"let 鍗冲彲",
			"寮曠敤绫诲瀷",
			"let map 鍚庤皟鐢?map.add",
			"let 鏇寸畝娲?",
			"let 鏇存帹鑽?",
			"涓嶉渶瑕?var",
			"var 涓嶅繀瑕?",
			"var 鏄彲閫夐鏍?",
			"涓ょ缁戝畾鏂瑰紡",
			"鍧囧彲",
			"let can call add",
			"let is recommended",
			"var is unnecessary",
		])
	if (!claimsVarRequired && !claimsLetValidOrPreferred && !NORMAL_HASHMAP_MUTABILITY_CLAIM_RE.test(normalizedText)) {
		return false
	}
	return !matchesAny(normalizedText, [
		"compiler diagnostic",
		"compile diagnostic",
		"mut func add",
		"鏍锋湰椋庢牸",
		"sample style",
		"not claim",
		"涓嶈澹扮О",
	])
}

function reportsDuplicateCompletionAfterTimeout(normalizedText: string): boolean {
	if (!matchesAny(normalizedText, ["promise timed out", "error completing task", "attempt_completion"])) {
		return false
	}
	const repeatedReportHeadings =
		countOccurrences(normalizedText, "cangjie evidence audit") +
		countOccurrences(normalizedText, "task completion report") +
		countOccurrences(normalizedText, "浠诲姟瀹屾垚鎶ュ憡")
	return repeatedReportHeadings >= 2
}

function reportsUncitedHashMapSubscriptAssignment(normalizedText: string): boolean {
	if (!matchesAny(normalizedText, ["hashmap", "countstrings", "countwords", "璁℃暟", "缁熻"])) return false
	if (!/\b(?:counts|map)\s*\[[^\]\n]+\]\s*=/i.test(normalizedText)) return false
	return !matchesAny(normalizedText, [
		"operator [](k, value!: v)",
		"operator [](key: k, value!: v)",
		"operator func [](key: k, value!: v)",
		"operator func [](k, v)",
		"subscript assignment operator",
		"涓嬫爣璧嬪€?",
		"1731",
		"1734",
	])
}

function reportsFabricatedMatchDataDefault(normalizedText: string): boolean {
	if (!matchesAny(normalizedText, ["regex.find", ".find(", "matchdata"])) return false
	return /(?:new\s+)?matchdata\s*\(/i.test(normalizedText)
}

function reportsForeignCollectionApiShape(normalizedText: string): boolean {
	const foreignHashMapApi = /\bhashmap(?:<[^>\n]+>)?\s*\.\s*(?:put|containskey)\b/i.test(normalizedText)
	const foreignArrayListApi =
		normalizedText.includes("arraylist") &&
		/\b(?:arraylist(?:<[^>\n]+>)?|list|items|result|values)\s*\.\s*(?:append|insert)\s*\(/i.test(normalizedText) &&
		!/(?:do not|don't|avoid|禁止|不要|不能|不应)[^\n]{0,80}\b(?:append|insert)\s*\(/i.test(normalizedText)
	return foreignHashMapApi || foreignArrayListApi
}

function reportsInvalidOptionDefaultCall(normalizedText: string): boolean {
	return /\bgetorthrow\s*\(\s*(?!\))/i.test(normalizedText)
}

function reportsNonRawRegexDigitPattern(normalizedText: string): boolean {
	if (!matchesAny(normalizedText, ["regex", "digit", "鏁板瓧", "extractfirstnumber", "鎻愬彇"])) return false
	return /regex\s*\(\s*["']\\\\d\+["']\s*\)/i.test(normalizedText)
}

function reportsUnsafeOptionUnwrapGuidance(normalizedText: string): boolean {
	if (!normalizedText.includes("getorthrow")) return false
	if (
		matchesAny(normalizedText, [
			"some is already proven",
			"known to be some",
			"after checking issome",
			"match",
			"getordefault",
			"??",
			"case some",
			"case none",
			"if-let",
			"if let",
			"宸茬‘璁?some",
			"鍏堝垽鏂?issome",
			"澶勭悊 none",
		])
	) {
		return false
	}
	return matchesAny(normalizedText, [
		"safe to call getorthrow",
		"getorthrow is safe",
		"use getorthrow directly",
		"directly call getorthrow",
		"鐩存帴 getorthrow",
		"鐩存帴璋冪敤 getorthrow",
		"鍙互鐩存帴鐢?getorthrow",
	])
}

function reportsUnsupportedFileTextRisk(normalizedText: string): boolean {
	if (
		!matchesAny(normalizedText, ["file.readfrom", "string.fromutf8", "readtextfile"]) ||
		!matchesAny(normalizedText, ["array<byte>", "array<uint8>", "byte", "uint8"])
	) {
		return false
	}
	const reportsRisk = matchesAny(normalizedText, [
		"type mismatch",
		"type compatibility",
		"potential risk",
		"may fail",
		"possibly incompatible",
		"could be incompatible",
		"娼滃湪椋庨櫓",
		"鍙兘瀛樺湪",
		"绫诲瀷涓嶅尮閰?",
		"绫诲瀷鍏煎",
		"闇€瑕佺‘璁?",
	])
	if (!reportsRisk) return false
	const hasPositiveSampleEvidence =
		matchesAny(normalizedText, ["file_samples.md", "official sample", "sample usage"]) &&
		!/(?:no|without)\s+[\s\S]{0,120}(?:file_samples\.md|official sample|sample usage)/i.test(normalizedText)
	const hasPositiveBuildEvidence =
		matchesAny(normalizedText, ["cjpm build success", "build success", "缂栬瘧鎴愬姛", "缂栬瘧閫氳繃"]) &&
		!/(?:no|without)\s+[\s\S]{0,120}(?:cjpm build success|build success)/i.test(normalizedText)
	return !hasPositiveSampleEvidence && !hasPositiveBuildEvidence
}

function usesWrappedCangjieToolchainCommand(normalizedText: string): boolean {
	return normalizedText.split(/\r?\n/).some((line) => {
		return (
			/(?:^|\s)(?:[a-z]:\s*&&\s*)?(?:cd|chdir)\s+(?:\/d\s+)?[^&|;\n]+&&\s*(?:cjpm|cjc|cjlint|cjfmt|cjdb|cjprof)\b/i.test(
				line,
			) || /\bset-location\s+[^;&|\n]+[;&|]+\s*(?:cjpm|cjc|cjlint|cjfmt|cjdb|cjprof)\b/i.test(line)
		)
	})
}

function reportsCangjieToolchainFromDesktop(normalizedText: string): boolean {
	return normalizedText.split(/\r?\n/).some((line) => {
		if (!/\b(?:cjpm\s+(?:build|check)|cjc\b|cjlint\b|cjfmt\b)/i.test(line)) {
			return false
		}
		return /c:\\users\\[^\\\s]+\\desktop\b/.test(line) || /\bdesktop\b/.test(line)
	})
}

function matchesAny(text: string, needles: string[]): boolean {
	return needles.some((needle) => text.includes(needle))
}

function countOccurrences(text: string, needle: string): number {
	let count = 0
	let offset = 0
	while (true) {
		const index = text.indexOf(needle, offset)
		if (index < 0) {
			return count
		}
		count += 1
		offset = index + needle.length
	}
}

function countCommandInvocationLines(text: string, command: string): number {
	return text.split(/\r?\n/).filter((line) => {
		const trimmed = line.trim().replace(/[.:]+$/, "")
		return trimmed === command || trimmed === `running ${command}` || trimmed === `姝ｅ湪杩愯 ${command}`
	}).length
}

function extractCangjieEvalCaseIdFromLine(line: string): string | undefined {
	if (!isCangjieEvalCaseMarkerLine(line)) {
		return undefined
	}
	return resolveCangjieEvalCaseId(line)
}

function isCangjieEvalCaseMarkerLine(line: string): boolean {
	const trimmed = line.trim()
	return (
		/^#{1,6}\s+/.test(trimmed) ||
		/^(?:case|case id|eval case)\s*[:=]/i.test(trimmed) ||
		/^\*\*.*\*\*$/.test(trimmed)
	)
}

function normalizeCangjieEvalCaseText(text: string): string {
	return text
		.trim()
		.replace(/^#{1,6}\s*/, "")
		.replace(/^\*\*(.*)\*\*$/, "$1")
		.replace(/^[-*]\s*/, "")
		.toLowerCase()
}

function formatCangjieEvalReportMarkdownZh(report: CangjieEvalReport, options: CangjieEvalReportFormatOptions): string {
	const lines = [
		"# 仓颉评测报告",
		"",
		"运行总数：" + report.totalRuns,
		"通过：" + report.passed,
		"失败：" + report.failed,
		"未知：" + report.unknown,
	]
	const failingScores = report.scores.filter((score) => score.status === "failed")
	const unknownScores = report.scores.filter((score) => score.status === "unknown-case")

	if (failingScores.length > 0) {
		lines.push("", "## 失败用例")
		for (const score of failingScores) {
			lines.push("- " + formatCangjieEvalCaseReportLabel(score.caseId, options))
			lines.push("  - 验证状态：" + formatCangjieEvalVerificationStatus(score.verificationStatus, "zh"))
			if (score.missingBehaviors.length > 0) {
				lines.push(
					"  - 缺失行为：" +
						score.missingBehaviors
							.map((behavior) => formatCangjieEvalBehavior(behavior, { language: "zh" }))
							.join("，"),
				)
			}
			if (score.missingCommands.length > 0) {
				lines.push("  - 缺失命令：" + score.missingCommands.join("，"))
			}
			if (score.violations && score.violations.length > 0) {
				lines.push("  - 违规：" + score.violations.join("，"))
			}
			if (score.recommendedNextSteps.length > 0) {
				lines.push(
					"  - 下一步建议：" + score.recommendedNextSteps.map(formatCangjieEvalRecommendationZh).join(" "),
				)
			}
		}
	}

	if (unknownScores.length > 0) {
		lines.push("", "## 未知用例")
		for (const score of unknownScores) {
			lines.push("- " + formatCangjieEvalCaseReportLabel(score.caseId, options))
		}
	}

	if (failingScores.length === 0 && unknownScores.length === 0) {
		lines.push("", "所有已评测的仓颉用例均通过。")
	}

	return lines.join("\n")
}

function formatCangjieEvalVerificationStatus(
	status: CangjieEvalVerificationStatus,
	language: CangjieEvalReportLanguage,
): string {
	if (language !== "zh") {
		return status
	}
	switch (status) {
		case "passed":
			return "通过"
		case "failed":
			return "失败"
		case "inconclusive":
			return "不确定"
		case "not-run":
			return "未运行"
	}
}

function formatCangjieEvalRecommendationZh(recommendation: string): string {
	switch (recommendation) {
		case "Run CangjieExplore to inspect cjpm.toml and relevant .cj files.":
			return "运行 CangjieExplore 检查 cjpm.toml 和相关 .cj 文件。"
		case "Run CangjieExplore to collect bundled Cangjie corpus evidence.":
			return "运行 CangjieExplore 收集内置仓颉语料证据。"
		case "Capture real cjpm/cjc/cjlint output before repair.":
			return "修复前先获取真实 cjpm/cjc/cjlint 输出。"
		case "Run CangjieVerify with cjpm build.":
			return "交给 CangjieVerify 运行 cjpm build。"
		case "Use CangjieRepair for a narrow 1-2 root-cause fix.":
			return "使用 CangjieRepair 做 1-2 个根因的窄范围修复。"
		case "Compare diagnostics between verification rounds before editing again.":
			return "再次编辑前先比较多轮验证诊断变化。"
		case "Hand the failing diagnostics to CangjieRepair.":
			return "把失败诊断交给 CangjieRepair。"
		case "Run CangjieVerify before accepting the case.":
			return "验收前先运行 CangjieVerify。"
		case "Capture readable command output or explicitly mark verification inconclusive.":
			return "获取可读命令输出，或明确标记验证不确定。"
		case "Check the case id against CANGJIE_EVAL_CASES.":
			return "检查 case id 是否存在于 CANGJIE_EVAL_CASES。"
		case "Respect explicit command allowlists; do not retry with rewritten commands or alternate shells.":
			return "遵守显式命令清单；不要用改写后的命令或替代 shell 重试。"
		case "Run each explicitly allowed command at most once unless the user requests a retry.":
			return "每条显式允许的命令最多运行一次，除非用户要求重试。"
		case "Report only commands actually invoked; mark unavailable commands as not attempted.":
			return "只报告实际调用过的命令；未能调用的命令标记为 not attempted。"
		case "Run Cangjie toolchain commands from the cjpm project directory, not Desktop.":
			return "从 cjpm 项目目录运行仓颉工具链命令，而不是 Desktop。"
		default:
			return recommendation
	}
}

function recommendCangjieEvalNextSteps(
	missingBehaviors: CangjieEvalBehavior[],
	missingCommands: string[],
	verificationStatus: CangjieEvalVerificationStatus,
	violations: CangjieEvalViolation[] = [],
): string[] {
	const recommendations = new Set<string>()

	if (missingBehaviors.includes("inspect-cjpm-project") || missingBehaviors.includes("read-relevant-source")) {
		recommendations.add("Run CangjieExplore to inspect cjpm.toml and relevant .cj files.")
	}
	if (missingBehaviors.includes("read-corpus-evidence")) {
		recommendations.add("Run CangjieExplore to collect bundled Cangjie corpus evidence.")
	}
	if (missingBehaviors.includes("use-real-toolchain-output")) {
		recommendations.add("Capture real cjpm/cjc/cjlint output before repair.")
	}
	if (missingBehaviors.includes("run-cjpm-build") || missingCommands.includes("cjpm build")) {
		recommendations.add("Run CangjieVerify with cjpm build.")
	}
	if (missingBehaviors.includes("minimal-edits") || missingBehaviors.includes("no-unrelated-file-edits")) {
		recommendations.add("Use CangjieRepair for a narrow 1-2 root-cause fix.")
	}
	if (missingBehaviors.includes("report-diagnostic-progress") || missingBehaviors.includes("stop-on-stagnation")) {
		recommendations.add("Compare diagnostics between verification rounds before editing again.")
	}
	if (missingBehaviors.includes("record-context-injection")) {
		recommendations.add(
			"Include the Cangjie Context Injection Audit so evals can see which prompt context was injected.",
		)
	}
	if (verificationStatus === "failed") {
		recommendations.add("Hand the failing diagnostics to CangjieRepair.")
	}
	if (verificationStatus === "not-run") {
		recommendations.add("Run CangjieVerify before accepting the case.")
	}
	if (verificationStatus === "inconclusive") {
		recommendations.add("Capture readable command output or explicitly mark verification inconclusive.")
	}
	if (violations.includes("command-allowlist-violation")) {
		recommendations.add(
			"Respect explicit command allowlists; do not retry with rewritten commands or alternate shells.",
		)
	}
	if (violations.includes("duplicate-allowlisted-command")) {
		recommendations.add("Run each explicitly allowed command at most once unless the user requests a retry.")
	}
	if (violations.includes("unverified-command-ledger")) {
		recommendations.add("Report only commands actually invoked; mark unavailable commands as not attempted.")
	}
	if (violations.includes("wrong-toolchain-working-directory")) {
		recommendations.add("Run Cangjie toolchain commands from the cjpm project directory, not Desktop.")
	}
	if (violations.includes("toolchain-wrapper-command")) {
		recommendations.add("Run Cangjie toolchain commands directly; do not wrap them with shell directory switches.")
	}
	if (violations.includes("allowlist-extra-probe-narration")) {
		recommendations.add("For explicit command allowlists, do not announce or plan extra project/file probes.")
	}
	if (violations.includes("user-output-request")) {
		recommendations.add(
			"Do not ask the user to paste terminal output; report verification inconclusive when output is unavailable.",
		)
	}
	if (violations.includes("stagnant-repair-edit")) {
		recommendations.add("When diagnostics stagnate, gather fresh corpus/LSP evidence before editing again.")
	}
	if (violations.includes("unsupported-file-text-risk")) {
		recommendations.add(
			"Cite the official std.fs file sample or a successful cjpm build before reporting File.readFrom/String.fromUtf8 as risky.",
		)
	}
	if (violations.includes("unsafe-option-unwrap-guidance")) {
		recommendations.add(
			"Do not recommend unguarded Option.getOrThrow(); prove Some or use ??, getOrDefault, or match.",
		)
	}
	if (violations.includes("invalid-option-default-call")) {
		recommendations.add(
			"Do not pass defaults to Option.getOrThrow; use ?? or getOrDefault({ => ... }) for default values.",
		)
	}
	if (violations.includes("fabricated-matchdata-default")) {
		recommendations.add(
			"Do not invent MatchData constructors; handle Regex.find None by returning a domain default.",
		)
	}
	if (violations.includes("foreign-collection-api-shape")) {
		recommendations.add("Use Cangjie HashMap.add/get/contains/remove signatures from std.collection evidence.")
	}
	if (violations.includes("non-raw-regex-digit-pattern")) {
		recommendations.add('Prefer Cangjie raw regex strings such as Regex(#"\\d+"#) for digit patterns.')
	}
	if (violations.includes("evidence-report-invites-coding")) {
		recommendations.add("End evidence-only Cangjie reports with a closed status; do not invite immediate coding.")
	}
	if (violations.includes("uncited-hashmap-subscript-assignment")) {
		recommendations.add(
			"Use HashMap.add for count updates unless the report cites operator [](K, value!: V) evidence.",
		)
	}
	if (violations.includes("unsupported-hashmap-mutability-claim")) {
		recommendations.add("Do not claim HashMap.add requires var/mut unless compiler or API evidence says so.")
	}
	if (violations.includes("duplicate-completion-after-timeout")) {
		recommendations.add(
			"After attempt_completion times out, do not resubmit the full report; provide one short status sentence.",
		)
	}
	if (violations.includes("contradictory-verification-report")) {
		recommendations.add(
			"When readable output contains cjpm build success, report verification as passed, not inconclusive.",
		)
	}
	if (violations.includes("context-audit-missing-labels")) {
		recommendations.add("List the actual injected Cangjie context labels in context audit reports.")
	}
	if (violations.includes("context-audit-scope")) {
		recommendations.add(
			"Keep context injection audits limited to injected labels; omit project status, directory trees, source lists, and symbols unless asked.",
		)
	}

	return [...recommendations]
}

function hasNegatedCommand(text: string, command: string): boolean {
	return [
		`did not run ${command}`,
		`didn't run ${command}`,
		`do not run ${command}`,
		`does not run ${command}`,
		`not run ${command}`,
		`without running ${command}`,
		`no ${command}`,
		`鏈繍琛?${command}`,
		`娌℃湁杩愯 ${command}`,
		`没有运行 ${command}`,
		`鏈墽琛?${command}`,
		`娌℃湁鎵ц ${command}`,
		`涓嶈繍琛?${command}`,
	].some((phrase) => text.includes(phrase))
}
