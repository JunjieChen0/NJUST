// Agent-facing prompt templates — Chinese strings are intentionally kept in Chinese
// to match Cangjie compiler error output and provide context to the LLM.
// Do NOT i18n these strings; they target the AI agent, not the VS Code UI.
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

import type { CangjieContextIntensity } from "../../task/CangjieRuntimePolicy"
import type { ICangjiePromptServices } from "../../../services/interfaces/ICangjiePromptServices"
import { CangjiePromptServices } from "../../../services/CangjiePromptServices"
import {
	DEFAULT_CANGJIE_CONTEXT_TOKEN_BUDGET,
	estimateCangjieContextTokensForTest,
	estimateContextTokens,
	addPrioritized,
	buildMandatoryCorpusFooter,
	packSectionsWithTokenBudget,
	simpleHash,
	type PrioritizedCangjieSection,
} from "./cangjieContext/budget"
import { STDLIB_CRITICAL_SIGNATURES } from "./cangjieContext/stdlibSignatures"
import { getLearnedFixesFileMtime } from "./learnedFixesStorage"
import {
	extractImports as _extractImports,
	mapImportsToDocPaths as _mapImportsToDocPaths,
	resolveImportedSymbols as _resolveImportedSymbols,
} from "./CangjieImportParser"
import {
	buildCangjieExecuteCommandErrorAppendix as buildCangjieExecuteCommandErrorAppendixFromModule,
	enhanceCjcErrorOutput as enhanceCjcErrorOutputFromModule,
	getErrorFixDirective as getErrorFixDirectiveFromModule,
} from "./CangjiePromptErrorAnalysis"
import { resolveBundledCangjieCorpusPath, resolveCangjieDocsBasePath } from "./CangjieDocsResolver"
import {
	collectActiveCangjieEditorSnapshot as _collectActiveCangjieEditorSnapshot,
	getActiveCangjieFileInfo as _getActiveCangjieFileInfo,
	type StructuredEditingContextPreparse,
} from "./CangjieSymbolExtractor"
import {
	buildCompactProjectOverviewSection,
	buildProjectPackageValidationSection,
	buildWorkspaceSymbolSummary,
	getCachedPackageHierarchy,
	getCjpmTreeSection,
	invalidateCjpmProjectParserCaches,
	parseCjpmToml,
	parseCjpmTomlWithMeta,
	scanPackageHierarchy,
	verifyPackageDeclarations,
} from "./cangjieContext/cjpmProjectParser"
import {
	buildConversionHintByMessage,
	buildDiagnosticAugmentationLines,
	collectDiagnosticSnapshot,
	mapDiagnosticsToDocContext,
	sampleCangjieDiagnostics,
} from "./cangjieContext/diagnosticHandling"
import {
	bumpCangjieL3TtlConfigCache,
	computeContextCacheKey,
	deleteContextSectionInFlight,
	detectCangjieRelevanceForAuxiliaryModes,
	getCachedContextSection,
	getCachedHeavyContext,
	getCachedProjectOverview,
	getContextSectionInFlight,
	getCangjieSystemPromptCacheKeySuffix,
	invalidateCangjieContextSectionCacheState,
	invalidateCangjieL3ContextCacheState,
	setCachedContextSection,
	setCachedHeavyContext,
	setCachedProjectOverview,
	setContextSectionInFlight,
	userMessageSuggestsCangjie,
	type HeavyContextBundle,
} from "./cangjieContext/cacheManagement"
import { buildContextualCodingRules } from "./cangjieContext/contextualCodingRules"
import { buildCangjieAgentRoutingSection } from "../../agent/CangjieAgentRouter"
import {
	buildAutoCorpusSearchSection,
	buildAutoCorpusQueries,
	buildCompileErrorCorpusSearch,
	buildCorpusExtraFewShotSection,
	buildStdlibSignatureHintsSection,
} from "./cangjieContext/corpusQueryBuilding"
import {
	buildCangjieStyleFewShotSection,
	invalidateLearnedFixMatchingCaches,
	loadLearnedFixesSection,
	recordLearnedFailure,
	recordLearnedFix,
	testLearnedFixPatternMatchesMessage,
	testNormalizeLearnedFixText,
} from "./cangjieContext/learnedFixMatching"
import {
	buildStructuredEditingContext,
	invalidateStructuredEditingContextCache,
} from "./cangjieContext/structuredEditingContext"

let _cangjieServices: ICangjiePromptServices | undefined

export function setCangjiePromptServices(services: ICangjiePromptServices): void {
	_cangjieServices = services
}

export function getCangjiePromptServices(): ICangjiePromptServices {
	if (!_cangjieServices) {
		// Lazy-init with default implementation so module-level code that calls
		// getCangjiePromptServices() during import does not crash.
		_cangjieServices = new CangjiePromptServices()
	}
	return _cangjieServices
}

export { bumpCangjieL3TtlConfigCache }
export { detectCangjieRelevanceForAuxiliaryModes, getCangjieSystemPromptCacheKeySuffix, userMessageSuggestsCangjie }
export { recordLearnedFix, recordLearnedFailure }
export { testLearnedFixPatternMatchesMessage, testNormalizeLearnedFixText }
export type { StructuredEditingContextPreparse } from "./CangjieSymbolExtractor"

export function invalidateCangjieContextSectionCache(): void {
	invalidateCangjieContextSectionCacheState()
	invalidateCjpmProjectParserCaches()
	invalidateLearnedFixMatchingCaches()
	invalidateStructuredEditingContextCache()
}

export function invalidateCangjieL3ContextCache(): void {
	invalidateCangjieL3ContextCacheState()
}

function buildCangjieModeToolchainRulesSection(): string {
	return [
		"## Cangjie Mode Toolchain Rules",
		"- Recommended agent pipeline: CangjieExplore -> CangjieImplement -> CangjieVerify -> CangjieRepair -> CangjieVerify.",
		"- Use CangjieExplore for project/corpus evidence, CangjieImplement for requested feature edits, CangjieVerify for toolchain validation, and CangjieRepair only after real toolchain failure output.",
		"- If the user asks only for corpus evidence, an investigation plan, or explicitly says not to modify files, stop after the evidence/plan report. Do not ask follow-up questions about implementation details or invite immediate coding. End with a closed status like `Evidence collected; no files were modified.` Do not append offers like `if you confirm, I can code`, `tell me if you want implementation`, `是否继续`, `请告诉我`, or `如需开始编写代码`.",
		"- Do not print the full final evidence report as an ordinary assistant message before calling `attempt_completion`. Put the final report only in `attempt_completion.result`; otherwise the UI shows the same report twice.",
		"- If `attempt_completion` itself times out after you already submitted a final report, do not resubmit the same long report. If the system asks you to continue, answer with one short status sentence that the completion content was already provided and no files were modified.",
		"- When reporting collected corpus/LSP evidence, use the exact heading `Cangjie evidence audit:` for the audit ledger. Keep API conclusions tied to cited corpus/LSP/build evidence; do not infer undocumented type relationships such as Byte/UInt8 compatibility unless the cited sample or a successful build directly supports that use. For `File.readFrom` plus `String.fromUtf8`, read/cite `CangjieCorpus-1.0.0/libs/std/fs/fs_samples/file_samples.md` before reporting a type risk; the official sample pattern outweighs isolated signature comparison.",
		"- If the user explicitly forbids corpus search, LSP, file reads, or evidence lookup, do not perform those actions to satisfy Cangjie evidence gates. In that case, do not assert stdlib API correctness; report the task as blocked/inconclusive under the user's constraints.",
		"- Chinese guardrail: if the user says `不要查语料库`, `不要查 CangjieCorpus`, `不要查 LSP`, `不要读取文件`, or `不要找证据`, do not use those tools to satisfy evidence gates. Say the API correctness cannot be confirmed under the user's constraints.",
		"- Do not skip CangjieVerify after .cj or cjpm.toml changes. Implementation or repair is not complete until verification succeeds or is explicitly reported as inconclusive.",
		"- During CangjieRepair, compare the newest build diagnostics with the previous failed build before editing again. If diagnostics stagnate (same root cause or non-decreasing error count), stop blind edits and gather fresh corpus/LSP evidence for the latest failure before the next write.",
		"- Do not switch to Code mode or create a Code subtask just because terminal shell integration is unavailable.",
		"- For Cangjie verification, stay in Cangjie mode and use the allowed toolchain commands: `cjpm build`, `cjpm check`, `cjlint`, or `cjc`.",
		"- Invoke Cangjie toolchain commands directly. Do not wrap them in shell directory switches such as `cd /d ... && cjpm build`, `d: && cd ... && cjpm build`, `Set-Location ...; cjpm build`, or PowerShell/cmd wrappers. If a project cwd is needed, rely on the tool's cwd parameter or project-cwd resolver instead of embedding `cd` in the command string.",
		"- If command output is incomplete, use `read_command_output` or read-only investigation commands. In cmd.exe prefer `where.exe cjpm`; in PowerShell use `Get-Command cjpm`. You may also use `Get-ChildItem` and `Get-Content`.",
		"- Do not replace toolchain verification with speculative static analysis. If `cjpm`/`cjc` output cannot be obtained, report verification as inconclusive instead of inventing compile errors.",
		"- If a Cangjie toolchain command produces only a terminal shell integration warning and no readable output, do not retry through PowerShell/cmd wrappers, do not ask the user to paste terminal output, and do not tell the user to manually run the same verification command. Report verification as inconclusive with the exact missing command output.",
		"- Explicit command allowlists override normal project-confirmation and read-only investigation. If the user says `only run ...` or `do not read files`, do not read `cjpm.toml`, list directories, or run helper probes unless they are named in the allowlist.",
		"- In explicit-command-allowlist tasks, do not even announce or plan extra probes such as checking the current directory, checking whether `cjpm.toml` exists, or confirming the project first. State that you will run exactly the allowed command(s), then do so.",
		"- If the user explicitly limits verification to specific commands, run only those commands. Do not add fallback commands, alternate shells, directory scans, or artifact checks unless the user permits them.",
		"- Keep an execution ledger for explicit-command-allowlist tasks. Before the final answer, compare the ledger against visible tool calls. Only report a command as attempted if you actually invoked that exact command; otherwise report it as `not attempted` with the reason.",
		"- In explicit-command-allowlist tasks, run each allowed command at most once. A timeout, shell integration warning, or unavailable execute_command result counts as that command's attempt; do not repeat it and do not replace it with a similar command.",
		"- Never substitute allowlisted commands with equivalent probes. For example, if the allowlist says `where.exe cjpm`, do not run `where cjpm`, `Get-Command cjpm`, or `powershell -Command ...`. If it says `cjpm build 2>&1`, do not run `cjpm build`, `cd /d ... && cjpm build`, or any PowerShell wrapper.",
		"- If an explicitly allowed command only returns a terminal shell integration warning and no readable command output, do not rewrite or retry the command. Report verification as inconclusive after the allowed commands have been attempted or after command execution becomes unavailable.",
	].join("\n")
}

function buildContextInjectionAuditSection(labels: string[]): string {
	const uniqueLabels = [...new Set(labels)].filter(Boolean)
	if (uniqueLabels.length === 0) return ""
	return [
		"## Cangjie Context Injection Audit",
		"This run injected these Cangjie context groups into the prompt:",
		...uniqueLabels.map((label) => `- ${label}`),
		"Use this audit when evaluating which context sources influenced the agent response.",
		"If the user asks only which Cangjie context was injected, answer only with this context audit/list and stop; do not add project status, directory trees, source-file lists, current-symbol summaries, project diagnostics, stdlib API correctness claims, or implementation advice unless the user explicitly asks for that analysis.",
		"Treat `stdlib-signature-hints` as prompt context only. It is not external corpus/LSP evidence and must not be used by itself to claim stdlib API correctness.",
	].join("\n")
}

export async function getCangjieContextSection(
	cwd: string,
	mode: string,
	extensionPath?: string,
	tokenBudget: number = DEFAULT_CANGJIE_CONTEXT_TOKEN_BUDGET,
	globalStoragePath?: string,
	lastUserHintForRelevance?: string,
	contextIntensity: CangjieContextIntensity = "full",
	recentBuildRootCauses: string[] = [],
	repairDirective?: string,
	delegatedAgentTypes: string[] = [],
): Promise<string> {
	const runCangjieContext =
		mode === "cangjie" ||
		((mode === "ask" || mode === "architect") &&
			detectCangjieRelevanceForAuxiliaryModes(cwd, lastUserHintForRelevance))
	if (!runCangjieContext) return ""

	const diagSnapshot = collectDiagnosticSnapshot()
	const contextSectionKey = `${await computeContextCacheKey(cwd, diagSnapshot.diagSummaryHash)}|tb:${tokenBudget}|m:${mode}|intensity:${contextIntensity}|route:${simpleHash(lastUserHintForRelevance ?? "")}|agents:${simpleHash(delegatedAgentTypes.join("|"))}|rc:${simpleHash(recentBuildRootCauses.join("|"))}|rd:${simpleHash(repairDirective ?? "")}`
	const now = Date.now()
	const cachedContextSection = getCachedContextSection(contextSectionKey, now)
	if (cachedContextSection) return cachedContextSection

	const inflight = getContextSectionInFlight(contextSectionKey)
	if (inflight) return inflight

	const p = (async (): Promise<string> => {
		const docsBase = resolveCangjieDocsBasePath(extensionPath)
		let docsExist = false
		if (docsBase != null) {
			try {
				await fs.promises.access(docsBase)
				docsExist = true
			} catch {
				docsExist = false
			}
		}
		const includeHeavyContext = contextIntensity === "full"

		const prioritized: PrioritizedCangjieSection[] = []
		const contextLabelsByContent = new Map<string, string>()
		const addContext = (label: string, priority: number, content: string | null | undefined): void => {
			if (content) contextLabelsByContent.set(content, label)
			addPrioritized(prioritized, priority, content)
		}
		let treeSectionPromise: Promise<string | null> = Promise.resolve(null)
		let styleFewShot: string | null = null
		const modeToolchainRulesSection = buildCangjieModeToolchainRulesSection()
		const agentRoutingSection = lastUserHintForRelevance
			? buildCangjieAgentRoutingSection(lastUserHintForRelevance, delegatedAgentTypes, {
					repairRequired: Boolean(repairDirective),
					freshEvidenceRequired: repairDirective?.includes("Fallback required") ?? false,
				})
			: null

		const activeFileInfo = _getActiveCangjieFileInfo()

		// 0a. Project structure context (cjpm.toml) - L1 cache
		const { info: projectInfo, cjpmRawHash } = await parseCjpmTomlWithMeta(cwd)
		if (projectInfo) {
			const projectOverviewKey = `${cwd}|${cjpmRawHash}|active:${activeFileInfo?.packageName ?? "-"}`
			let overview = getCachedProjectOverview(projectOverviewKey, now)
			if (overview === null) {
				overview = await buildCompactProjectOverviewSection(
					cwd,
					projectInfo,
					activeFileInfo?.packageName ?? null,
					activeFileInfo?.filePath ?? null,
				)
				setCachedProjectOverview(projectOverviewKey, overview, now)
			}
			addContext("project-overview", 490, overview)
		}

		// 0b. package declaration verification + cjpm tree
		if (projectInfo && includeHeavyContext) {
			if (!projectInfo.isWorkspace) {
				const rootPkgName = projectInfo.name || undefined
				const pkgTree = await getCachedPackageHierarchy(cwd, projectInfo.srcDir, rootPkgName)
				if (pkgTree) {
					const pkgMismatches = await verifyPackageDeclarations(pkgTree, cwd, projectInfo.srcDir)
					addContext("package-declaration-check", 515, pkgMismatches || undefined)
				}
			} else {
				for (const member of projectInfo.members || []) {
					const memberCwd = path.join(cwd, member.path)
					const memberTree = await getCachedPackageHierarchy(memberCwd, "src", member.name)
					if (memberTree) {
						const pkgMismatches = await verifyPackageDeclarations(memberTree, memberCwd, "src")
						addContext("package-declaration-check", 515, pkgMismatches || undefined)
					}
				}
			}

			// cjpm tree — started in parallel; awaited below
			treeSectionPromise = getCjpmTreeSection(cwd)
		}

		// Collect imports + symbols from visible editors (single pass)
		const { imports, symbols: editorSymbolsSnapshot, activePreparse } = _collectActiveCangjieEditorSnapshot()
		const rawDiagnostics = diagSnapshot.allCjDiags
		const rawErrorCount = rawDiagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length

		// Symbol scanning, import analysis, and doc mapping are only performed
		// when a cjpm.toml project exists, to keep context lightweight otherwise.
		if (projectInfo && includeHeavyContext) {
			const idx = getCangjiePromptServices().getCangjieSymbolIndex()
			const importsHash = simpleHash([...imports].sort().join("|"))
			const learnedFixesMtime = getLearnedFixesFileMtime(cwd)
			const heavyContextKey = [
				cwd,
				`idx:${idx?.fileCount ?? 0}:${idx?.symbolCount ?? 0}`,
				`imports:${imports.length}:${importsHash}`,
				`lf:${learnedFixesMtime}`,
				`ws:${projectInfo.isWorkspace ? 1 : 0}`,
			].join("::")
			let heavyBundle: HeavyContextBundle | null = getCachedHeavyContext(heavyContextKey, now)
			if (!heavyBundle) {
				heavyBundle = {
					symbols: editorSymbolsSnapshot,
					importedSymbols: _resolveImportedSymbols(imports, cwd, projectInfo),
					stdlibHints: await buildStdlibSignatureHintsSection(imports, docsBase, globalStoragePath),
					workspaceSummary: projectInfo.isWorkspace
						? await buildWorkspaceSymbolSummary(projectInfo, cwd)
						: null,
					fewShot: await buildCangjieStyleFewShotSection(cwd, imports, rawDiagnostics, cjpmRawHash),
				}
				setCachedHeavyContext(heavyContextKey, heavyBundle, now)
			}
			styleFewShot = heavyBundle.fewShot
			addContext("visible-editor-symbols", 380, heavyBundle.symbols || undefined)
			addContext("imported-workspace-symbols", 390, heavyBundle.importedSymbols || undefined)
			addContext("stdlib-signature-hints", 395, heavyBundle.stdlibHints || undefined)
			if (includeHeavyContext) {
				addContext("workspace-symbol-summary", 528, heavyBundle.workspaceSummary || undefined)
			}

			// 1. Import-based documentation context
			if (includeHeavyContext && imports.length > 0 && docsBase && docsExist) {
				const docMappings = _mapImportsToDocPaths(imports)
				if (docMappings.length > 0) {
					const importContext = docMappings
						.map((m) => {
							const paths = m.docPaths.map((p) => p.replace(/\\/g, "/")).join(", ")
							return `- \`${m.prefix}\`: ${m.summary} (请视需检索: ${paths})`
						})
						.join("\n")

					addContext(
						"import-to-corpus-doc-map",
						350,
						`## 当前代码涉及的重要模块映射\n\n当前代码中已引入以下高级模块。若后续编写代码缺乏十足把握，强烈建议立刻使用 \`search_files\`（regex 搜索）检索这些官方库示例：\n\n${importContext}`,
					)
				}
			}
		}

		const diagSample = sampleCangjieDiagnostics(rawDiagnostics)
		const diagnostics = diagSample.sampled
		const conversionByMessage = buildConversionHintByMessage(diagnostics)
		const errorSections =
			diagnostics.length > 0 && docsBase && docsExist
				? mapDiagnosticsToDocContext(diagnostics, docsBase, conversionByMessage)
				: []

		if (includeHeavyContext) {
			addContext(
				"compile-history",
				95,
				getCangjiePromptServices().getCangjieCompileHistory().formatCompileHistoryPromptSection(cwd),
			)
		}

		if (recentBuildRootCauses.length > 0) {
			addContext(
				"recent-build-root-causes",
				92,
				`## Recent Cangjie Build Root Causes\n- ${recentBuildRootCauses.slice(0, 4).join("\n- ")}`,
			)
		}

		if (repairDirective) {
			addContext("compile-repair-directive", 93, `## Cangjie Compile-Repair Directive\n${repairDirective}`)
		}

		// 1b. Dynamic coding rules injection (context-aware).
		addContext(
			"contextual-coding-rules",
			650,
			buildContextualCodingRules(imports, projectInfo, rawDiagnostics, errorSections.length > 0) || undefined,
		)
		if (includeHeavyContext) {
			addContext("style-few-shot", 850, styleFewShot || undefined)
		}

		// 2. Error/diagnostic context (sampled + merged messages for prompt), kept late in final order.
		let diagnosticSection: string | null = null
		if (errorSections.length > 0) {
			const omitNote =
				diagSample.omitted > 0
					? `\n\n_共 ${diagSample.total} 条诊断，以上展示经重要性筛选与消息合并；另有 ${diagSample.omitted} 条未列出。_`
					: ""
			diagnosticSection = `## 当前诊断错误与修复建议\n\n检测到以下编译/检查错误，建议参考对应文档修复：\n\n${errorSections.join("\n")}${omitNote}`
			const aug = buildDiagnosticAugmentationLines(diagnostics, cwd, conversionByMessage, diagSnapshot.byFile)
			if (aug.length > 0) {
				diagnosticSection += `\n\n### 辅助定位（根因/类型转换）\n${aug.join("\n")}`
			}
			addContext("diagnostics-and-fix-hints", 90, diagnosticSection)
		}

		// 2a. Intent-matched few-shot from bundled corpus extra/
		if (includeHeavyContext && docsBase && docsExist) {
			addContext(
				"intent-matched-corpus-extra",
				750,
				(await buildCorpusExtraFewShotSection(docsBase, imports, rawDiagnostics, lastUserHintForRelevance)) ||
					undefined,
			)
		}

		// 2b. Auto-inject corpus search results based on imports and diagnostics
		if (includeHeavyContext && docsBase && docsExist) {
			addContext(
				"auto-corpus-search-results",
				550,
				(await buildAutoCorpusSearchSection(docsBase, imports, diagnostics)) || undefined,
			)
		}

		const mandatoryFooter = buildMandatoryCorpusFooter(docsBase, docsExist)

		// 4. Structured editing context + awaiting parallel promises
		const activeEd = vscode.window.activeTextEditor
		let structuredPre: StructuredEditingContextPreparse | undefined
		if (activeEd && (activeEd.document.languageId === "cangjie" || activeEd.document.fileName.endsWith(".cj"))) {
			structuredPre = activePreparse
				? { ...activePreparse, diagnosticsByFile: diagSnapshot.byFile }
				: (() => {
						const c = activeEd.document.getText()
						return {
							content: c,
							lines: c.split("\n"),
							imports: _extractImports(c),
							defs: getCangjiePromptServices().getCangjieParser().parseCangjieDefinitions(c),
							diagnosticsByFile: diagSnapshot.byFile,
						}
					})()
		}
		const [editingCtx, treeSection] = await Promise.all([
			buildStructuredEditingContext(structuredPre),
			treeSectionPromise,
		])
		addContext("cjpm-tree", 525, treeSection || undefined)
		addContext("structured-editing-context", 150, editingCtx || undefined)

		// 5. Project-curated learned fixes (optional JSON in .njust_ai/)
		addContext("learned-fixes", 250, loadLearnedFixesSection(cwd, rawDiagnostics) || undefined)

		const diagTokensEstimate = diagnosticSection ? estimateContextTokens(diagnosticSection) : 0
		const packed = packSectionsWithTokenBudget(prioritized, mandatoryFooter, Math.max(500, tokenBudget), {
			rawErrorCount,
			totalDiagnosticCount: rawDiagnostics.length,
			diagnosticSectionMinTokens: rawErrorCount > 0 ? Math.min(Math.max(diagTokensEstimate, 480), 1200) : 0,
		})
		packed.unshift(modeToolchainRulesSection)
		if (agentRoutingSection) packed.splice(1, 0, agentRoutingSection)
		const contextAuditSection = buildContextInjectionAuditSection([
			"toolchain-rules",
			agentRoutingSection ? "agent-route" : "",
			...packed
				.map((section) => contextLabelsByContent.get(section))
				.filter((label): label is string => Boolean(label)),
			mandatoryFooter.trim() ? "mandatory-corpus-footer" : "",
		])
		if (contextAuditSection) packed.splice(1, 0, contextAuditSection)
		if (diagnosticSection) {
			const idx = packed.indexOf(diagnosticSection)
			if (idx >= 0) {
				packed.splice(idx, 1)
				packed.push(diagnosticSection)
			}
		}
		if (packed.length === 0) return ""

		const auxiliaryNote =
			mode === "ask" || mode === "architect"
				? "\n（以下仓颉语料与工程上下文仅供查阅；请保持当前 Ask/Architect 模式的角色与职责。）"
				: ""

		const result = `====

CANGJIE DEVELOPMENT CONTEXT${auxiliaryNote}

${packed.join("\n\n")}
`
		setCachedContextSection(contextSectionKey, result)
		return result
	})()
	setContextSectionInFlight(contextSectionKey, p)
	void p.finally(() => deleteContextSectionInFlight(contextSectionKey))
	return p
}

/**
 * Enhance a cjc/cjlint error message with documentation references and fix suggestions.
 * Called when terminal output contains compilation errors.
 */

export function enhanceCjcErrorOutput(errorOutput: string, cwd: string, extensionPath?: string): Promise<string> {
	return enhanceCjcErrorOutputFromModule(errorOutput, cwd, extensionPath)
}

/**
 * Single appendix for **execute_command** on cjpm/cjc failure: either per-`==>` blocks with
 * nearby source + pattern hints (no duplicate tail blob), or {@link enhanceCjcErrorOutput} when
 * the output has no `==>` headers.
 */
export function buildCangjieExecuteCommandErrorAppendix(
	output: string,
	cwd: string,
	extensionPath?: string,
): Promise<string> {
	return buildCangjieExecuteCommandErrorAppendixFromModule(output, cwd, extensionPath)
}

// Error fix directives are now defined in CangjieErrorAnalyzer.ts; re-export here.
export const getErrorFixDirective = getErrorFixDirectiveFromModule

// Re-export for testing and backward compatibility
export {
	_extractImports,
	_extractImports as extractImports,
	_mapImportsToDocPaths,
	STDLIB_CRITICAL_SIGNATURES,
	DEFAULT_CANGJIE_CONTEXT_TOKEN_BUDGET,
	estimateCangjieContextTokensForTest,
	parseCjpmToml,
	scanPackageHierarchy,
	_resolveImportedSymbols,
	resolveBundledCangjieCorpusPath,
	resolveCangjieDocsBasePath,
	verifyPackageDeclarations,
	buildCompactProjectOverviewSection,
	buildProjectPackageValidationSection,
	buildWorkspaceSymbolSummary,
	buildStructuredEditingContext,
	buildCompileErrorCorpusSearch,
	buildAutoCorpusQueries,
}
// Barrel re-exports for downstream consumers:
// - activate/CodeActionProvider.ts uses matchCjcErrorPattern
// - core/task/CangjieRuntimePolicy.ts uses getMatchingCjcPatternsByCategory
// TODO: migrate these consumers to use ICangjiePromptServices, then remove this block.
export {
	CJC_ERROR_PATTERNS,
	STDLIB_DOC_MAP,
	matchCjcErrorPattern,
	getMatchingCjcPatternsByCategory,
	type CjcErrorPattern,
	type DocMapping,
} from "../../../services/cangjie-lsp/CangjieErrorAnalyzer"
