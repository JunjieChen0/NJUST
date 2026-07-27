import * as path from "path"
import * as fs from "fs/promises"

import { getStorageBasePath, getTaskDirectoryPath } from "../utils/storage"
import { getErrorMessage } from "../shared/error-utils"
import { logger } from "../shared/logger"
import { CANGJIE_EVAL_CASES, resolveCangjieEvalCaseId } from "../core/agent/cangjieEvalCases"

export type CangjieEvalTraceStage = "attempt_completion" | "attempt_completion_blocked"
export type CangjieEvalTraceVerdict = "passed" | "blocked" | "failed" | "inconclusive" | "unknown"

export interface CangjieEvalTraceInput {
	globalStoragePath?: string
	taskId?: string
	rootTaskId?: string
	parentTaskId?: string
	cwd?: string
	mode?: string
	stage: CangjieEvalTraceStage
	result: string
	blockReason?: string
	toolUsage?: unknown
	runtimeSnapshot?: CangjieEvalRuntimeSnapshot
	taskText?: string
}

export interface CangjieEvalRuntimeSnapshot {
	writeRevision: number
	validatedRevision: number
	recentBuildSucceeded: boolean
	recentBuildFailed: boolean
	compileFailureRounds: number
	stagnantFailureRounds: number
	searchedStdModules: string[]
	corpusReadModules: string[]
	corpusReadPathCount: number
	pendingEvidenceModules: string[]
	evidenceRecordCount: number
	recentBuildCommand?: string
	delegatedAgentTypes?: string[]
	repairAttemptCount?: number
	repairLoopExhausted?: boolean
	verificationOnlyRoute?: boolean
}

export interface CangjieEvalTraceAnalysis {
	verdict: CangjieEvalTraceVerdict
	resultPreview: string
	resultLength: number
	hasCangjieEvidenceAudit: boolean
	hasCangjieContextInjectionAudit: boolean
	injectedContextLabels: string[]
	mentionsBuildSuccess: boolean
	mentionsVerificationInconclusive: boolean
	forbiddenHashMapPhrases: string[]
	detectedEvidenceModules: string[]
}

export interface CangjieEvalTraceEntry extends CangjieEvalTraceAnalysis {
	timestamp?: string
	taskId?: string
	rootTaskId?: string
	parentTaskId?: string
	cwd?: string
	mode?: string
	stage?: CangjieEvalTraceStage
	attemptNumber?: number
	priorBlockedAttempts?: number
	priorBlockReasonCodes?: string[]
	blockReasonCode?: string
	blockReason?: string
	toolUsage?: unknown
	runtimeSnapshot?: CangjieEvalRuntimeSnapshot
	evalCaseId?: string
}

export interface CangjieEvalTraceSummary {
	totalEntries: number
	validEntries: number
	corruptEntries: number
	verdictCounts: Record<CangjieEvalTraceVerdict, number>
	reclassifiedEntries: number
	distinctTaskCount: number
	taskOutcomeCounts: Record<CangjieEvalTraceVerdict, number>
	taskPassRate: number
	recoveredPassedTaskCount: number
	attentionTasks: CangjieEvalTaskOutcome[]
	taskBehaviorCounts: CangjieEvalTaskBehaviorCounts
	coveredEvalCaseIds: string[]
	passedEvalCaseIds: string[]
	missingEvalCaseIds: string[]
	evalCaseCoverageRate: number
	latestEntry?: CangjieEvalTraceEntry
	latestVerdict?: CangjieEvalTraceVerdict
	latestVerdictStreak: number
	latestTaskId?: string
	latestEvalCaseId?: string
	nextEvalCaseId?: string
	latestStage?: CangjieEvalTraceStage
	latestAttemptNumber?: number
	latestPriorBlockedAttempts?: number
	latestBlockReasonCode?: string
	recentBlockReasonCodes: string[]
	recentBlockReasonCounts: Record<string, number>
	latestInjectedContextLabels: string[]
	latestRuntimeSnapshot?: CangjieEvalRuntimeSnapshot
}

export interface CangjieEvalTaskOutcome {
	taskId: string
	verdict: CangjieEvalTraceVerdict
	reason: string
	stage?: CangjieEvalTraceStage
	blockReasonCode?: string
	attemptNumber?: number
}

export interface CangjieEvalTaskBehaviorCounts {
	withRuntimeSnapshot: number
	withAgentDelegation: number
	withBuildCommand: number
	withCorpusRead: number
	withWrites: number
	withValidatedWrites: number
	withUnvalidatedWrites: number
	withPendingEvidence: number
	withCompileFailures: number
}

const TRACE_FILE_NAME = "cangjie-eval-trace.jsonl"
const WORKSPACE_TRACE_DIRECTORY = ".njust-ai"
const RESULT_PREVIEW_LIMIT = 4_000

const CANGJIE_EVIDENCE_AUDIT_RE = /\bCangjie evidence audit\s*:/i
const CANGJIE_CONTEXT_INJECTION_AUDIT_RE =
	/\bCangjie context injection (?:audit|list)\b|Cangjie\s+\u4e0a\u4e0b\u6587\u6ce8\u5165(?:\u5ba1\u8ba1|\u6e05\u5355)|\u4e0a\u4e0b\u6587\u6ce8\u5165(?:\u5ba1\u8ba1|\u6e05\u5355)/i
const CORPUS_MODULE_AUDIT_RE = /corpus read:\s*(std\.[a-z][a-z0-9_]*)/gi
const CORPUS_PATH_MODULE_RE = /CangjieCorpus-1\.0\.0\/libs\/std\/([a-z][a-z0-9_]*)\b/gi
const CANGJIE_CONTEXT_LABELS = [
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
const CANGJIE_CONTEXT_AUDIT_SCOPE_EXTRA_HEADINGS = [
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
	"源文件清单",
	"当前编辑上下文",
	"符号定义",
	"包结构",
] as const
const CANGJIE_CONTEXT_AUDIT_NEGATED_SCOPE_RE =
	/(?:未|没有|无需|不)(?:读取|查看|分析|展开|列出|修改)[^。\n]*(?:项目状态|当前项目状态|目录结构|源文件|源文件清单|当前编辑上下文|符号|符号定义|包结构|project status|directory tree|source files?|source-file list|current symbols?|current editing context|package structure)[^。\n]*(?:。|\n|$)/gi
const BUILD_SUCCESS_RE =
	/\bcjpm build success\b|\bcjpm build\b[^\r\n]{0,80}已通过(?:[^\r\n]{0,40}退出码\s*[:：]?\s*0)?|输出结果\s*[:：]\s*cjpm build success|编译结果\s*[:：]\s*(?:✅\s*)?成功|(?:项目)?构建(?:结果)?\s*(?:[:：]\s*)?(?:✅\s*)?成功/i
const VERIFICATION_INCONCLUSIVE_RE =
	/\bverification inconclusive\b|验证结果\s*[:：]\s*inconclusive|无法确定|不确定状态/i
const FAILURE_RE = /\bcjpm build failed\b|\berror:|\bfailed\b|编译失败|构建失败|验证失败/i

const FORBIDDEN_HASHMAP_PHRASES = [
	"add 必须 var",
	"add 必须用 var",
	"HashMap 变量必须声明为 var",
	"HashMap 变量必须用 var",
	"必须用 var",
	"add 是 mut 方法",
	"内置修复提示也确认",
	"let 可以调用 add",
	"let 可调 add",
	"let 就足够",
	"let 也可行",
	"let 更推荐",
	"不需要 var",
	"add 不是 mut",
	"不能断言 `add` 必须 `var`",
	"let 绑定即可",
	"let 而非 var",
	"let binding is enough",
	"let can call add",
	"add requires var",
]
const HASHMAP_MUTABILITY_WARNING_PATTERNS: Array<[string, RegExp]> = [
	["add-is-mut", /add\s*(?:\u662f|\u4e3a)\s*mut/i],
	[
		"method-no-mut-modifier",
		/(?:add|get|contains)[\s\S]{0,120}(?:\u6ca1\u6709|\u65e0|\u4e0d\u662f|\u4e0d\u53ef\u80fd\u662f)\s*mut\s*(?:\u4fee\u9970|\u4fee\u9970\u7b26|\u65b9\u6cd5)?/i,
	],
	["add-requires-var", /add[\s\S]{0,80}(?:\u5fc5\u987b|\u9700\u8981)[\s\S]{0,40}var/i],
	[
		"hashmap-requires-var",
		/HashMap[\s\S]{0,80}(?:\u53d8\u91cf|\u5b9e\u4f8b)?[\s\S]{0,40}(?:\u5fc5\u987b|\u9700\u8981|\u8981\u6c42)[\s\S]{0,40}var/i,
	],
	[
		"let-cannot-call-add",
		/\u4e0d\u80fd[\s\S]{0,80}let|let[\s\S]{0,160}(?:\u4e0d\u80fd|\u4e0d\u53ef)[\s\S]{0,100}add/i,
	],
	[
		"let-is-enough",
		/let[\s\S]{0,160}(?:\u7ed1\u5b9a)?[\s\S]{0,80}(?:\u5373\u53ef|\u8db3\u591f|\u53ef\u4ee5|\u53ef\u8c03|\u4e5f\u53ef\u884c|\u4e5f\u53ef\u4ee5)(?:[\s\S]{0,100}add)?/i,
	],
	["let-is-recommended", /let[\s\S]{0,120}(?:\u63a8\u8350|\u66f4\u7b80\u6d01)|let\s+is\s+recommended/i],
	[
		"var-unnecessary",
		/(?:\u4e0d\u9700\u8981|\u65e0\u9700)\s*var|var[\s\S]{0,40}(?:\u4e0d\u5fc5\u8981|\u53ef\u9009)|var\s+is\s+unnecessary|var\s+is\s+optional/i,
	],
	[
		"two-binding-styles-valid",
		/two binding styles (?:are )?valid|let\/var[\s\S]{0,80}(?:both|valid|optional)|(?:let|var)[\s\S]{0,80}(?:\u4e24\u79cd|\u5747\u53ef|\u90fd\u53ef|\u90fd\u662f)/i,
	],
]
const HASHMAP_MUTABILITY_CAUTION_RE =
	/(?:do not claim|not claim|unless .*compiler|unless .*API|\u4e0d\u8981\u58f0\u79f0|\u4e0d\u5e94\u65ad\u8a00|\u4e0d\u80fd\u65ad\u8a00|\u6837\u672c\u98ce\u683c)/i
const HASHMAP_MUTABILITY_UNSAFE_RECOMMENDATION_RE =
	/(?:\u63a8\u8350[\s\S]{0,40}let|let[\s\S]{0,40}\u800c\u975e[\s\S]{0,20}var|let[\s\S]{0,120}(?:\u7ed1\u5b9a)?[\s\S]{0,80}(?:\u63a8\u8350|\u66f4\u7b80\u6d01|\u5373\u53ef|\u8db3\u591f)|(?:\u4e0d\u9700\u8981|\u65e0\u9700)\s*var|var[\s\S]{0,40}(?:\u4e0d\u5fc5\u8981|\u53ef\u9009)|let\s+is\s+recommended|var\s+is\s+unnecessary|var\s+is\s+optional|two binding styles (?:are )?valid|let\/var[\s\S]{0,80}(?:both|valid|optional))/i
const HASHMAP_MUTABILITY_SAFE_PHRASE_RE =
	/(?:var follows the samples;\s*no let\/var semantic conclusion is made here|(?:\u6309|\u9075\u5faa)[\s\S]{0,20}\u6837\u4f8b[\s\S]{0,20}(?:\u4fdd\u5b88)?[\s\S]{0,10}\u4f7f\u7528\s*var[\s\S]{0,40}(?:\u4e0d\u505a|\u4e0d\u4f5c|\u4e0d\u7ed9\u51fa)[\s\S]{0,30}let\/var[\s\S]{0,20}(?:\u8bed\u4e49)?\u7ed3\u8bba)/i
const HASHMAP_MUTABILITY_SAFE_PHRASE_GLOBAL_RE =
	/(?:var follows the samples;\s*no let\/var semantic conclusion is made here|(?:\u6309|\u9075\u5faa)[\s\S]{0,20}\u6837\u4f8b[\s\S]{0,20}(?:\u4fdd\u5b88)?[\s\S]{0,10}\u4f7f\u7528\s*var[\s\S]{0,40}(?:\u4e0d\u505a|\u4e0d\u4f5c|\u4e0d\u7ed9\u51fa)[\s\S]{0,30}let\/var[\s\S]{0,20}(?:\u8bed\u4e49)?\u7ed3\u8bba)/gi
const HASHMAP_CONTEXT_RE = /(?:\bHashMap\b|\b(?:map|counts)\.add\s*\(|\badd\s*\()/i
const ARRAYLIST_CONTEXT_RE = /\bArrayList\b/i

function previewText(text: string): string {
	if (text.length <= RESULT_PREVIEW_LIMIT) {
		return text
	}
	return `${text.slice(0, RESULT_PREVIEW_LIMIT)}\n...[truncated ${text.length - RESULT_PREVIEW_LIMIT} chars]`
}

function extractDetectedEvidenceModules(text: string): string[] {
	const modules = new Set<string>()
	for (const match of text.matchAll(CORPUS_MODULE_AUDIT_RE)) {
		const moduleName = match[1]
		if (moduleName) modules.add(moduleName.toLowerCase())
	}
	for (const match of text.replace(/\\/g, "/").matchAll(CORPUS_PATH_MODULE_RE)) {
		const moduleName = match[1]
		if (moduleName) modules.add(`std.${moduleName.toLowerCase()}`)
	}
	return [...modules].sort()
}

function extractInjectedContextLabels(text: string): string[] {
	const normalized = text.toLowerCase()
	return CANGJIE_CONTEXT_LABELS.filter((label) => normalized.includes(label))
}

function hasContextAuditScopeExtra(text: string): boolean {
	const normalized = text.replace(CANGJIE_CONTEXT_AUDIT_NEGATED_SCOPE_RE, "").toLowerCase()
	return CANGJIE_CONTEXT_AUDIT_SCOPE_EXTRA_HEADINGS.some((heading) => normalized.includes(heading))
}

function classifyBlockReason(blockReason: string | undefined): string | undefined {
	if (!blockReason) return undefined
	if (/missing stdlib evidence|without external evidence/i.test(blockReason)) return "missing-stdlib-evidence"
	if (/changed after the last successful build|Run `cjpm build`/i.test(blockReason)) return "pending-build"
	if (/latest build failed/i.test(blockReason)) return "build-failed"
	if (/unsupported HashMap\.add let\/var mutability claim/i.test(blockReason)) return "unsupported-hashmap-mutability"
	if (/default value to Option\.getOrThrow/i.test(blockReason)) return "invalid-option-getorthrow-default"
	if (/HashMap\.get\(\.\.\.\)\.getOrThrow\(\).*counting update/i.test(blockReason))
		return "unsafe-hashmap-count-getorthrow"
	if (/Regex\.find as a zero-argument signature/i.test(blockReason)) return "incorrect-regex-find-signature"
	if (/HashMap subscript assignment without citing/i.test(blockReason)) return "uncited-hashmap-subscript-assignment"
	if (/extra project\/file probes/i.test(blockReason)) return "allowlist-extra-probe"
	if (/build succeeded but also reports verification as inconclusive/i.test(blockReason))
		return "contradictory-verification"
	if (/invites immediate coding/i.test(blockReason)) return "evidence-report-invitation"
	if (/Byte\/UInt8 type compatibility/i.test(blockReason)) return "unsupported-file-text-risk-speculation"
	if (/context-injection audit does not list the injected context labels/i.test(blockReason))
		return "context-audit-missing-labels"
	if (/context-injection audit includes extra project\/file\/symbol status/i.test(blockReason))
		return "context-audit-scope"
	return "other"
}

function createEmptyVerdictCounts(): Record<CangjieEvalTraceVerdict, number> {
	return {
		passed: 0,
		blocked: 0,
		failed: 0,
		inconclusive: 0,
		unknown: 0,
	}
}

function isCangjieEvalTraceVerdict(value: unknown): value is CangjieEvalTraceVerdict {
	return (
		value === "passed" ||
		value === "blocked" ||
		value === "failed" ||
		value === "inconclusive" ||
		value === "unknown"
	)
}

export function summarizeCangjieEvalTraceJsonl(text: string): CangjieEvalTraceSummary {
	const verdictCounts = createEmptyVerdictCounts()
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
	let latestEntry: CangjieEvalTraceEntry | undefined
	let validEntries = 0
	let corruptEntries = 0
	let reclassifiedEntries = 0
	const entries: CangjieEvalTraceEntry[] = []

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as CangjieEvalTraceEntry
			validEntries += 1
			latestEntry = entry
			entries.push(entry)
			const verdict = isCangjieEvalTraceVerdict(entry.verdict) ? entry.verdict : "unknown"
			verdictCounts[verdict] += 1
			if (getEffectiveVerdict(entry) !== verdict) reclassifiedEntries += 1
		} catch {
			corruptEntries += 1
		}
	}
	const recentBlockReasonCodes = getRecentBlockReasonCodes(entries, 5)
	const recentBlockReasonCounts = countBlockReasonCodes(recentBlockReasonCodes)
	const latestEntriesByTask = getLatestEntriesByTask(entries)
	const latestTaskEntries = getLatestTaskEntriesInOrder(entries, latestEntriesByTask)
	const latestTaskGroupId = latestEntry ? getTaskGroupId(latestEntry) : undefined
	const latestTaskEntry = latestTaskGroupId ? latestEntriesByTask.get(latestTaskGroupId) : undefined
	const latestVerdict = latestTaskEntry ? getEffectiveVerdict(latestTaskEntry) : undefined
	const latestVerdictStreak = latestVerdict ? countTrailingVerdictStreak(latestTaskEntries, latestVerdict) : 0
	const taskOutcomeCounts = createEmptyVerdictCounts()
	let recoveredPassedTaskCount = 0
	for (const entry of latestEntriesByTask.values()) {
		const verdict = getEffectiveVerdict(entry)
		taskOutcomeCounts[verdict] += 1
		if (verdict === "passed" && (entry.priorBlockedAttempts ?? 0) > 0) recoveredPassedTaskCount += 1
	}
	const taskPassRate = latestEntriesByTask.size > 0 ? taskOutcomeCounts.passed / latestEntriesByTask.size : 0
	const attentionTasks = getAttentionTasks(latestTaskEntries, 5)
	const taskBehaviorCounts = countTaskBehaviors(latestEntriesByTask.values())
	const coveredEvalCaseIds = getCoveredEvalCaseIds(latestEntriesByTask.values())
	const passedEvalCaseIds = getPassedEvalCaseIds(latestEntriesByTask.values())
	const allEvalCaseIds = CANGJIE_EVAL_CASES.map((testCase) => testCase.id)
	const missingEvalCaseIds = allEvalCaseIds.filter((caseId) => !coveredEvalCaseIds.includes(caseId))
	const evalCaseCoverageRate = allEvalCaseIds.length > 0 ? coveredEvalCaseIds.length / allEvalCaseIds.length : 0
	const latestTaskRuntimeSnapshot = latestTaskGroupId
		? latestEntriesByTask.get(latestTaskGroupId)?.runtimeSnapshot
		: undefined

	return {
		totalEntries: lines.length,
		validEntries,
		corruptEntries,
		verdictCounts,
		reclassifiedEntries,
		distinctTaskCount: latestEntriesByTask.size,
		taskOutcomeCounts,
		taskPassRate,
		recoveredPassedTaskCount,
		attentionTasks,
		taskBehaviorCounts,
		coveredEvalCaseIds,
		passedEvalCaseIds,
		missingEvalCaseIds,
		evalCaseCoverageRate,
		latestEntry,
		latestVerdict,
		latestVerdictStreak,
		latestTaskId: latestTaskGroupId,
		latestEvalCaseId: latestTaskGroupId ? latestEntriesByTask.get(latestTaskGroupId)?.evalCaseId : undefined,
		nextEvalCaseId: missingEvalCaseIds[0],
		latestStage: latestEntry?.stage,
		latestAttemptNumber: latestEntry?.attemptNumber,
		latestPriorBlockedAttempts: latestEntry?.priorBlockedAttempts,
		latestBlockReasonCode: latestEntry?.blockReasonCode,
		recentBlockReasonCodes,
		recentBlockReasonCounts,
		latestInjectedContextLabels: Array.isArray(latestEntry?.injectedContextLabels)
			? latestEntry.injectedContextLabels
			: [],
		latestRuntimeSnapshot: latestTaskRuntimeSnapshot,
	}
}

function getEffectiveVerdict(entry: CangjieEvalTraceEntry): CangjieEvalTraceVerdict {
	const storedVerdict = isCangjieEvalTraceVerdict(entry.verdict) ? entry.verdict : "unknown"
	const snapshot = entry.runtimeSnapshot
	const hasRecordedSemanticFailure =
		Boolean(entry.blockReasonCode) || (entry.forbiddenHashMapPhrases?.length ?? 0) > 0
	const hasSemanticFailure = hasRecordedSemanticFailure || isContextAuditScopeFailure(entry)
	if (
		(storedVerdict === "unknown" || storedVerdict === "failed") &&
		entry.stage === "attempt_completion" &&
		snapshot?.recentBuildCommand
	) {
		if (snapshot.recentBuildFailed) return "failed"
		if (
			snapshot.recentBuildSucceeded &&
			snapshot.pendingEvidenceModules.length === 0 &&
			snapshot.writeRevision <= snapshot.validatedRevision &&
			!hasSemanticFailure &&
			(storedVerdict === "unknown" ||
				entry.mentionsBuildSuccess === true ||
				(typeof entry.resultPreview === "string" && BUILD_SUCCESS_RE.test(entry.resultPreview)))
		) {
			return "passed"
		}
	}
	if (
		(storedVerdict === "unknown" || storedVerdict === "failed") &&
		entry.stage &&
		typeof entry.resultPreview === "string" &&
		!hasRecordedSemanticFailure
	) {
		const currentVerdict = analyzeCangjieEvalTraceText(entry.resultPreview, entry.stage, entry.blockReason).verdict
		if (currentVerdict !== "unknown") return currentVerdict
	}
	return storedVerdict
}

function getEffectiveReason(entry: CangjieEvalTraceEntry, verdict: CangjieEvalTraceVerdict): string {
	if (verdict === "failed" && entry.stage === "attempt_completion" && isContextAuditScopeFailure(entry)) {
		return "context-audit-scope"
	}
	return (
		entry.blockReasonCode ??
		entry.forbiddenHashMapPhrases?.[0] ??
		(verdict === "unknown"
			? "no-conclusive-verdict"
			: verdict === "inconclusive"
				? "verification-inconclusive"
				: "failed-result")
	)
}

function isContextAuditScopeFailure(entry: CangjieEvalTraceEntry): boolean {
	if (typeof entry.resultPreview !== "string" || !hasContextAuditScopeExtra(entry.resultPreview)) return false
	if (entry.hasCangjieContextInjectionAudit === true) return true
	return analyzeCangjieEvalTraceText(entry.resultPreview, entry.stage ?? "attempt_completion", entry.blockReason)
		.hasCangjieContextInjectionAudit
}

function getTaskGroupId(entry: CangjieEvalTraceEntry): string | undefined {
	return entry.rootTaskId ?? entry.taskId
}

function mergeRuntimeSnapshots(
	current: CangjieEvalRuntimeSnapshot | undefined,
	next: CangjieEvalRuntimeSnapshot | undefined,
): CangjieEvalRuntimeSnapshot | undefined {
	if (!next) return current
	if (!current) {
		return {
			...next,
			searchedStdModules: [...next.searchedStdModules],
			corpusReadModules: [...next.corpusReadModules],
			pendingEvidenceModules: [...next.pendingEvidenceModules],
			delegatedAgentTypes: [...(next.delegatedAgentTypes ?? [])],
		}
	}

	const mergeStrings = (left: string[], right: string[] = []) => [...new Set([...left, ...right])]
	const hasNewerBuild = Boolean(next.recentBuildCommand)
	const mergedWriteRevision = Math.max(current.writeRevision, next.writeRevision)
	const mergedValidatedRevision = Math.max(
		current.validatedRevision,
		next.validatedRevision,
		hasNewerBuild && next.recentBuildSucceeded ? mergedWriteRevision : 0,
	)
	return {
		writeRevision: mergedWriteRevision,
		validatedRevision: mergedValidatedRevision,
		recentBuildSucceeded: hasNewerBuild ? next.recentBuildSucceeded : current.recentBuildSucceeded,
		recentBuildFailed: hasNewerBuild ? next.recentBuildFailed : current.recentBuildFailed,
		compileFailureRounds: Math.max(current.compileFailureRounds, next.compileFailureRounds),
		stagnantFailureRounds: Math.max(current.stagnantFailureRounds, next.stagnantFailureRounds),
		searchedStdModules: mergeStrings(current.searchedStdModules, next.searchedStdModules),
		corpusReadModules: mergeStrings(current.corpusReadModules, next.corpusReadModules),
		corpusReadPathCount: Math.max(current.corpusReadPathCount, next.corpusReadPathCount),
		pendingEvidenceModules: mergeStrings(current.pendingEvidenceModules, next.pendingEvidenceModules),
		evidenceRecordCount: Math.max(current.evidenceRecordCount, next.evidenceRecordCount),
		recentBuildCommand: next.recentBuildCommand ?? current.recentBuildCommand,
		delegatedAgentTypes: mergeStrings(current.delegatedAgentTypes ?? [], next.delegatedAgentTypes),
		repairAttemptCount: Math.max(current.repairAttemptCount ?? 0, next.repairAttemptCount ?? 0),
		repairLoopExhausted: Boolean(current.repairLoopExhausted || next.repairLoopExhausted),
		verificationOnlyRoute: Boolean(current.verificationOnlyRoute || next.verificationOnlyRoute),
	}
}

function getLatestEntriesByTask(entries: CangjieEvalTraceEntry[]): Map<string, CangjieEvalTraceEntry> {
	const latestEntries = new Map<string, CangjieEvalTraceEntry>()
	for (const entry of entries) {
		const taskGroupId = getTaskGroupId(entry)
		if (!taskGroupId) continue
		const previous = latestEntries.get(taskGroupId)
		const inferredEvalCaseId =
			typeof entry.resultPreview === "string" ? resolveCangjieEvalCaseId(entry.resultPreview) : undefined
		latestEntries.set(taskGroupId, {
			...entry,
			taskId: taskGroupId,
			evalCaseId: inferredEvalCaseId ?? entry.evalCaseId ?? previous?.evalCaseId,
			runtimeSnapshot: mergeRuntimeSnapshots(previous?.runtimeSnapshot, entry.runtimeSnapshot),
		})
	}
	return latestEntries
}

function getLatestTaskEntriesInOrder(
	entries: CangjieEvalTraceEntry[],
	latestEntriesByTask: Map<string, CangjieEvalTraceEntry>,
): CangjieEvalTraceEntry[] {
	const seen = new Set<string>()
	const ordered: CangjieEvalTraceEntry[] = []
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const taskGroupId = getTaskGroupId(entries[index]!)
		if (!taskGroupId || seen.has(taskGroupId)) continue
		seen.add(taskGroupId)
		const mergedEntry = latestEntriesByTask.get(taskGroupId)
		if (mergedEntry) ordered.unshift(mergedEntry)
	}
	return ordered
}

function getCoveredEvalCaseIds(entries: Iterable<CangjieEvalTraceEntry>): string[] {
	return [
		...new Set([...entries].map((entry) => entry.evalCaseId).filter((caseId): caseId is string => Boolean(caseId))),
	].sort()
}

function getPassedEvalCaseIds(entries: Iterable<CangjieEvalTraceEntry>): string[] {
	return [
		...new Set(
			[...entries]
				.filter((entry) => getEffectiveVerdict(entry) === "passed")
				.map((entry) => entry.evalCaseId)
				.filter((caseId): caseId is string => Boolean(caseId)),
		),
	].sort()
}

function getAttentionTasks(entries: CangjieEvalTraceEntry[], limit: number): CangjieEvalTaskOutcome[] {
	const seen = new Set<string>()
	const outcomes: CangjieEvalTaskOutcome[] = []
	for (let index = entries.length - 1; index >= 0 && outcomes.length < limit; index -= 1) {
		const entry = entries[index]
		const taskGroupId = entry ? getTaskGroupId(entry) : undefined
		if (!entry || !taskGroupId || seen.has(taskGroupId)) continue
		seen.add(taskGroupId)
		const verdict = getEffectiveVerdict(entry)
		if (verdict === "passed") continue
		outcomes.push({
			taskId: taskGroupId,
			verdict,
			reason: getEffectiveReason(entry, verdict),
			stage: entry.stage,
			blockReasonCode: entry.blockReasonCode,
			attemptNumber: entry.attemptNumber,
		})
	}
	return outcomes
}

function countTaskBehaviors(entries: Iterable<CangjieEvalTraceEntry>): CangjieEvalTaskBehaviorCounts {
	const counts: CangjieEvalTaskBehaviorCounts = {
		withRuntimeSnapshot: 0,
		withAgentDelegation: 0,
		withBuildCommand: 0,
		withCorpusRead: 0,
		withWrites: 0,
		withValidatedWrites: 0,
		withUnvalidatedWrites: 0,
		withPendingEvidence: 0,
		withCompileFailures: 0,
	}
	for (const entry of entries) {
		const snapshot = entry.runtimeSnapshot
		if (!snapshot) continue
		counts.withRuntimeSnapshot += 1
		if ((snapshot.delegatedAgentTypes?.length ?? 0) > 0) counts.withAgentDelegation += 1
		if (snapshot.recentBuildCommand) counts.withBuildCommand += 1
		if (snapshot.corpusReadModules.length > 0) counts.withCorpusRead += 1
		if (snapshot.writeRevision > 0) {
			counts.withWrites += 1
			if (snapshot.validatedRevision >= snapshot.writeRevision) {
				counts.withValidatedWrites += 1
			} else {
				counts.withUnvalidatedWrites += 1
			}
		}
		if (snapshot.pendingEvidenceModules.length > 0) counts.withPendingEvidence += 1
		if (snapshot.compileFailureRounds > 0) counts.withCompileFailures += 1
	}
	return counts
}

function countTrailingVerdictStreak(entries: CangjieEvalTraceEntry[], verdict: CangjieEvalTraceVerdict): number {
	let streak = 0
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]
		if (!entry) break
		const entryVerdict = getEffectiveVerdict(entry)
		if (entryVerdict !== verdict) {
			break
		}
		streak += 1
	}
	return streak
}

function getRecentBlockReasonCodes(entries: CangjieEvalTraceEntry[], limit: number): string[] {
	const codes: string[] = []
	for (let index = entries.length - 1; index >= 0 && codes.length < limit; index -= 1) {
		const code = entries[index]?.blockReasonCode
		if (code) {
			codes.push(code)
		}
	}
	return codes
}

function countBlockReasonCodes(codes: string[]): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const code of codes) counts[code] = (counts[code] ?? 0) + 1
	return counts
}

export async function readCangjieEvalTraceSummary(filePath: string): Promise<CangjieEvalTraceSummary> {
	try {
		const text = await fs.readFile(filePath, "utf8")
		return summarizeCangjieEvalTraceJsonl(text)
	} catch {
		return summarizeCangjieEvalTraceJsonl("")
	}
}

export function getCangjieWorkspaceEvalTracePath(cwd: string): string {
	return path.join(cwd, WORKSPACE_TRACE_DIRECTORY, TRACE_FILE_NAME)
}

export async function getCangjieGlobalEvalTracePath(globalStoragePath: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	if (path.resolve(basePath) !== path.resolve(globalStoragePath)) {
		return path.join(basePath, TRACE_FILE_NAME)
	}

	const durableDirectory = path.join(
		path.dirname(globalStoragePath),
		`.${path.basename(globalStoragePath)}-cangjie-roadmap`,
	)
	const durableTracePath = path.join(durableDirectory, TRACE_FILE_NAME)
	const legacyTracePath = path.join(basePath, TRACE_FILE_NAME)

	try {
		await fs.access(durableTracePath)
		return durableTracePath
	} catch {
		// First run after upgrading: preserve the trace that lived in extension globalStorage.
	}

	try {
		const legacyTrace = await fs.readFile(legacyTracePath, "utf8")
		await fs.mkdir(durableDirectory, { recursive: true })
		await fs.writeFile(durableTracePath, legacyTrace, { encoding: "utf8", flag: "wx" })
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== "ENOENT" && code !== "EEXIST") {
			logger.warn("CangjieEvalTraceLogger", `Failed to migrate durable global trace: ${getErrorMessage(error)}`)
		}
	}

	return durableTracePath
}

export function getCangjieEvalTraceNextAction(summary: CangjieEvalTraceSummary): string {
	if (summary.totalEntries === 0 || !summary.latestVerdict) {
		return "Run a Cangjie agent task in this workspace to create an eval trace."
	}

	switch (summary.latestVerdict) {
		case "passed":
			if (summary.nextEvalCaseId) {
				return `Run the next uncovered Cangjie eval case: ${summary.nextEvalCaseId} (${summary.coveredEvalCaseIds.length}/${CANGJIE_EVAL_CASES.length} covered).`
			}
			return `Continue to the next roadmap stage; the latest ${summary.latestVerdictStreak} trace entr${summary.latestVerdictStreak === 1 ? "y is" : "ies are"} passing.${summary.attentionTasks.length > 0 ? ` ${summary.attentionTasks.length} historical attention task${summary.attentionTasks.length === 1 ? " remains" : "s remain"} for regression cleanup.` : ""}`
		case "blocked":
			return summary.latestBlockReasonCode
				? `Resolve the ${summary.latestBlockReasonCode} completion gate, then retry the task.`
				: "Resolve the latest completion gate, then retry the task."
		case "failed":
			return "Inspect the latest result preview and correct the reported agent behavior before retesting."
		case "inconclusive":
			return "Repeat verification when real compiler or terminal output can be captured."
		case "unknown":
			return "Inspect the raw trace entry because no conclusive verdict was detected."
	}
}

export function formatCangjieEvalTraceSummaryMarkdown(summary: CangjieEvalTraceSummary): string {
	const verdictParts = (Object.entries(summary.verdictCounts) as Array<[CangjieEvalTraceVerdict, number]>)
		.filter(([, count]) => count > 0)
		.map(([verdict, count]) => `${verdict}: ${count}`)
	const taskOutcomeParts = (Object.entries(summary.taskOutcomeCounts) as Array<[CangjieEvalTraceVerdict, number]>)
		.filter(([, count]) => count > 0)
		.map(([verdict, count]) => `${verdict}: ${count}`)
	const labels =
		summary.latestInjectedContextLabels.length > 0 ? summary.latestInjectedContextLabels.join(", ") : "none"
	const lines = [
		"Cangjie eval trace summary:",
		`- total entries: ${summary.totalEntries} (${summary.validEntries} valid, ${summary.corruptEntries} corrupt)`,
		`- latest verdict: ${summary.latestVerdict ?? "none"}`,
		`- latest verdict streak: ${summary.latestVerdictStreak}`,
		`- latest task: ${summary.latestTaskId ?? "none"}`,
		`- latest eval case: ${summary.latestEvalCaseId ?? "none"}`,
		`- latest stage: ${summary.latestStage ?? "none"}`,
		`- latest task attempt: ${summary.latestAttemptNumber ?? "unknown"}`,
		`- prior blocked attempts: ${summary.latestPriorBlockedAttempts ?? "unknown"}`,
		`- stored verdict counts: ${verdictParts.length > 0 ? verdictParts.join(", ") : "none"}`,
		`- entries reclassified by current policy: ${summary.reclassifiedEntries}`,
		`- distinct tasks: ${summary.distinctTaskCount}`,
		`- task outcomes (latest per task): ${taskOutcomeParts.length > 0 ? taskOutcomeParts.join(", ") : "none"}`,
		`- task pass rate: ${(summary.taskPassRate * 100).toFixed(1)}%`,
		`- recovered passed tasks: ${summary.recoveredPassedTaskCount}`,
		`- eval case coverage: ${summary.coveredEvalCaseIds.length}/${CANGJIE_EVAL_CASES.length} (${(summary.evalCaseCoverageRate * 100).toFixed(1)}%); passed ${summary.passedEvalCaseIds.length}; missing ${summary.missingEvalCaseIds.length}`,
		`- task behavior coverage: snapshots ${summary.taskBehaviorCounts.withRuntimeSnapshot}/${summary.distinctTaskCount}; agent delegation ${summary.taskBehaviorCounts.withAgentDelegation}; build ${summary.taskBehaviorCounts.withBuildCommand}; corpus ${summary.taskBehaviorCounts.withCorpusRead}; writes ${summary.taskBehaviorCounts.withWrites}; validated writes ${summary.taskBehaviorCounts.withValidatedWrites}; unvalidated writes ${summary.taskBehaviorCounts.withUnvalidatedWrites}; pending evidence ${summary.taskBehaviorCounts.withPendingEvidence}; compile failures ${summary.taskBehaviorCounts.withCompileFailures}`,
		`- latest injected context labels: ${labels}`,
	]
	if (summary.latestRuntimeSnapshot) {
		const snapshot = summary.latestRuntimeSnapshot
		const buildState = !snapshot.recentBuildCommand
			? "not run"
			: snapshot.recentBuildSucceeded
				? "passed"
				: snapshot.recentBuildFailed
					? "failed"
					: "not validated"
		lines.push(
			`- runtime revisions: write ${snapshot.writeRevision}, validated ${snapshot.validatedRevision}`,
			`- build state: ${buildState}; failure rounds ${snapshot.compileFailureRounds}; stagnant rounds ${snapshot.stagnantFailureRounds}`,
			`- evidence state: ${snapshot.evidenceRecordCount} records; searched ${snapshot.searchedStdModules.length} std modules; read ${snapshot.corpusReadModules.length} corpus modules; pending ${snapshot.pendingEvidenceModules.length}`,
			`- delegated agents: ${snapshot.delegatedAgentTypes?.length ? snapshot.delegatedAgentTypes.join(" -> ") : "none"}`,
		)
	}
	if (summary.attentionTasks.length > 0) {
		lines.push(
			`- attention tasks: ${summary.attentionTasks
				.map(
					(task) =>
						`${task.taskId} (${task.verdict}: ${task.reason}${task.attemptNumber ? `, attempt ${task.attemptNumber}` : ""})`,
				)
				.join(", ")}`,
		)
	}
	if (summary.coveredEvalCaseIds.length > 0) {
		lines.push(`- covered eval cases: ${summary.coveredEvalCaseIds.join(", ")}`)
	}
	if (summary.missingEvalCaseIds.length > 0) {
		lines.push(`- missing eval cases: ${summary.missingEvalCaseIds.join(", ")}`)
	}
	if (summary.latestBlockReasonCode) {
		lines.push(`- latest block reason: ${summary.latestBlockReasonCode}`)
	}
	if (summary.recentBlockReasonCodes.length > 0) {
		const blockReasons = Object.entries(summary.recentBlockReasonCounts).map(
			([code, count]) => `${code}${count > 1 ? ` x${count}` : ""}`,
		)
		lines.push(`- recent block reasons: ${blockReasons.join(", ")}`)
	}
	lines.push(`- next action: ${getCangjieEvalTraceNextAction(summary)}`)
	return lines.join("\n")
}

async function readTraceStats(filePath: string): Promise<{
	attempts: number
	blockedAttempts: number
	priorBlockReasonCodes: string[]
}> {
	try {
		const text = await fs.readFile(filePath, "utf8")
		const lines = text.split(/\r?\n/).filter(Boolean)
		let blockedAttempts = 0
		const priorBlockReasonCodes = new Set<string>()
		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { stage?: string; blockReasonCode?: string }
				if (entry.stage === "attempt_completion_blocked") {
					blockedAttempts += 1
					if (entry.blockReasonCode) {
						priorBlockReasonCodes.add(entry.blockReasonCode)
					}
				}
			} catch {
				// Ignore corrupt legacy lines; the next append should still succeed.
			}
		}
		return { attempts: lines.length, blockedAttempts, priorBlockReasonCodes: [...priorBlockReasonCodes].sort() }
	} catch {
		return { attempts: 0, blockedAttempts: 0, priorBlockReasonCodes: [] }
	}
}

export function analyzeCangjieEvalTraceText(
	result: string,
	stage: CangjieEvalTraceStage,
	blockReason?: string,
): CangjieEvalTraceAnalysis {
	const isArrayListOnlyContext =
		ARRAYLIST_CONTEXT_RE.test(result) && !/(?:\bHashMap\b|\b(?:map|counts)\.add\s*\()/i.test(result)
	const hasHashMapContext = !isArrayListOnlyContext && HASHMAP_CONTEXT_RE.test(result)
	const hasHashMapSafePhrase = HASHMAP_MUTABILITY_SAFE_PHRASE_RE.test(result)
	const textWithoutHashMapSafePhrase = result.replace(HASHMAP_MUTABILITY_SAFE_PHRASE_GLOBAL_RE, "")
	const hashMapClaimText = hasHashMapSafePhrase ? textWithoutHashMapSafePhrase : result
	const isCautiousHashMapGuidance =
		!hasHashMapSafePhrase &&
		HASHMAP_MUTABILITY_CAUTION_RE.test(result) &&
		!HASHMAP_MUTABILITY_UNSAFE_RECOMMENDATION_RE.test(result)
	const forbiddenHashMapPhrases =
		!hasHashMapContext || isCautiousHashMapGuidance
			? []
			: [
					...FORBIDDEN_HASHMAP_PHRASES.filter((phrase) =>
						hashMapClaimText.toLowerCase().includes(phrase.toLowerCase()),
					),
					...HASHMAP_MUTABILITY_WARNING_PATTERNS.filter(([, pattern]) => pattern.test(hashMapClaimText)).map(
						([label]) => label,
					),
				]
	const mentionsBuildSuccess = BUILD_SUCCESS_RE.test(result)
	const mentionsVerificationInconclusive = VERIFICATION_INCONCLUSIVE_RE.test(result)
	let verdict: CangjieEvalTraceVerdict = "unknown"

	if (stage === "attempt_completion_blocked" || blockReason) {
		verdict = "blocked"
	} else if (forbiddenHashMapPhrases.length > 0 || FAILURE_RE.test(result)) {
		verdict = "failed"
	} else if (mentionsVerificationInconclusive) {
		verdict = "inconclusive"
	} else if (mentionsBuildSuccess) {
		verdict = "passed"
	} else if (stage === "attempt_completion" && CANGJIE_EVIDENCE_AUDIT_RE.test(result)) {
		verdict = "passed"
	}
	const injectedContextLabels = extractInjectedContextLabels(result)
	const hasCangjieContextInjectionAudit =
		CANGJIE_CONTEXT_INJECTION_AUDIT_RE.test(result) || injectedContextLabels.length > 0
	if (stage === "attempt_completion" && hasCangjieContextInjectionAudit && hasContextAuditScopeExtra(result)) {
		verdict = "failed"
	}
	if (
		stage === "attempt_completion" &&
		verdict === "unknown" &&
		CANGJIE_CONTEXT_INJECTION_AUDIT_RE.test(result) &&
		injectedContextLabels.length === 0
	) {
		verdict = "failed"
	}
	if (stage === "attempt_completion" && hasCangjieContextInjectionAudit && verdict === "unknown") {
		verdict = "passed"
	}

	return {
		verdict,
		resultPreview: previewText(result),
		resultLength: result.length,
		hasCangjieEvidenceAudit: CANGJIE_EVIDENCE_AUDIT_RE.test(result),
		hasCangjieContextInjectionAudit,
		injectedContextLabels,
		mentionsBuildSuccess,
		mentionsVerificationInconclusive,
		forbiddenHashMapPhrases,
		detectedEvidenceModules: extractDetectedEvidenceModules(result),
	}
}

function inferMissingWriteRevision(
	snapshot: CangjieEvalRuntimeSnapshot | undefined,
	toolUsage: unknown,
): CangjieEvalRuntimeSnapshot | undefined {
	if (!snapshot || snapshot.writeRevision > 0 || !toolUsage || typeof toolUsage !== "object") {
		return snapshot
	}

	const usage = toolUsage as Record<string, unknown>
	const hasSuccessfulWrite = ["apply_patch", "write_to_file", "edit_file"].some((toolName) => {
		const stats = usage[toolName]
		if (!stats || typeof stats !== "object") return false
		const attempts = Number((stats as Record<string, unknown>).attempts ?? 0)
		const failures = Number((stats as Record<string, unknown>).failures ?? 0)
		return Number.isFinite(attempts) && Number.isFinite(failures) && attempts > failures
	})

	return hasSuccessfulWrite ? { ...snapshot, writeRevision: 1 } : snapshot
}

export async function appendCangjieEvalTrace(input: CangjieEvalTraceInput): Promise<void> {
	if (!input.taskId) {
		return
	}

	try {
		const tracePaths: string[] = []
		let statsTracePath: string | undefined

		if (input.globalStoragePath) {
			const globalTracePath = await getCangjieGlobalEvalTracePath(input.globalStoragePath)
			const taskDir = await getTaskDirectoryPath(input.globalStoragePath, input.taskId)
			tracePaths.push(globalTracePath, path.join(taskDir, TRACE_FILE_NAME))
			statsTracePath = path.join(taskDir, TRACE_FILE_NAME)
		}
		if (input.cwd) {
			const workspaceTracePath = getCangjieWorkspaceEvalTracePath(input.cwd)
			tracePaths.push(workspaceTracePath)
			statsTracePath ??= workspaceTracePath
		}
		if (tracePaths.length === 0) {
			return
		}

		const taskTraceStats = await readTraceStats(statsTracePath!)
		const analysis = analyzeCangjieEvalTraceText(input.result, input.stage, input.blockReason)
		const evalCaseId = input.taskText ? resolveCangjieEvalCaseId(input.taskText) : undefined
		const entry = {
			timestamp: new Date().toISOString(),
			taskId: input.taskId,
			rootTaskId: input.rootTaskId,
			parentTaskId: input.parentTaskId,
			cwd: input.cwd,
			mode: input.mode,
			stage: input.stage,
			attemptNumber: taskTraceStats.attempts + 1,
			priorBlockedAttempts: taskTraceStats.blockedAttempts,
			priorBlockReasonCodes: taskTraceStats.priorBlockReasonCodes,
			blockReasonCode: classifyBlockReason(input.blockReason),
			blockReason: input.blockReason,
			toolUsage: input.toolUsage,
			runtimeSnapshot: inferMissingWriteRevision(input.runtimeSnapshot, input.toolUsage),
			evalCaseId,
			...analysis,
		}
		const line = `${JSON.stringify(entry)}\n`

		await Promise.all([...new Set(tracePaths)].map((tracePath) => appendLine(tracePath, line)))
	} catch (error) {
		logger.warn("CangjieEvalTraceLogger", `Failed to append trace: ${getErrorMessage(error)}`)
	}
}

async function appendLine(filePath: string, line: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.appendFile(filePath, line, "utf8")
}
