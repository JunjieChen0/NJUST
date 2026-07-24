import path from "path"

import { routeCangjieAgentTask, type CangjieAgentStage } from "../agent/CangjieAgentRouter"
import { getMatchingCjcPatternsByCategory, parseCjpmToml } from "../prompts/sections/cangjie-context"
import {
	CRITICAL_SIGNATURE_MODULES,
	SEARCH_GATE_EXEMPT_MODULES,
	extractStdImports,
} from "../tools/cangjiePreflightCheck"

export type CangjieContextIntensity = "compact" | "full"

const PROJECT_CACHE_TTL_MS = 5_000
const MAX_REPAIR_ATTEMPTS = 2
const VERIFICATION_ONLY_RE =
	/(?:\u53ea|\u4ec5)(?:\u8fd0\u884c|\u6267\u884c).{0,16}(?:cjpm\s+build|\u6784\u5efa|\u9a8c\u8bc1)|(?:\u4e0d\u8981|\u4e0d\u5141\u8bb8|\u7981\u6b62).{0,12}(?:\u4fee\u6539|\u4fee\u590d)|\bonly\s+(?:run|verify)\b|\bdo not\s+(?:modify|edit|repair)\b/i
const REPAIR_REQUEST_RE = /\u4fee\u590d|\u4fee\u6539|\u81ea\u52a8\u5904\u7406|repair|\bfix\b/i
const SOURCE_DELETE_REQUEST_RE = /\u5220\u9664|\u79fb\u9664|\bdelete\b|\bremove\b/i
const ALLOWED_SEGMENT_PREFIXES = [
	"cjpm",
	"cjc",
	"cjfmt",
	"cjlint",
	"cjdb",
	"cjprof",
	"rg",
	"Get-ChildItem",
	"Get-Content",
	"Select-String",
	"dir",
	"ls",
	"cat",
	"type",
	"pwd",
	"echo",
	"cd",
	"Set-Location",
	"where",
	"where.exe",
	"Get-Command",
] as const
const BUILD_COMMAND_RE = /\b(?:cjpm\s+(?:build|check)\b|cjc\b)/i
const CANGJIE_DIRECT_TOOLCHAIN_RE = /^\s*(?:cjpm|cjc|cjlint|cjfmt|cjdb|cjprof)\b/i
const INIT_COMMAND_RE = /\bcjpm\s+init\b/i
const PACKAGE_DECL_RE = /^\s*package\s+([\w.]+)\s*$/m
const CANGJIE_CORPUS_ROOT = "CangjieCorpus-1.0.0"
const STDLIB_EXTRA_EVIDENCE_PATHS: Readonly<Record<string, string[]>> = {
	"std.collection": [`${CANGJIE_CORPUS_ROOT}/extra/HashMap.md`, `${CANGJIE_CORPUS_ROOT}/extra/ArrayList.md`],
	"std.fs": [`${CANGJIE_CORPUS_ROOT}/extra/File.md`],
	"std.regex": [`${CANGJIE_CORPUS_ROOT}/extra/Regex.md`],
	"std.time": [`${CANGJIE_CORPUS_ROOT}/extra/Time.md`],
	"std.process": [`${CANGJIE_CORPUS_ROOT}/extra/Process.md`],
	"std.core": [`${CANGJIE_CORPUS_ROOT}/extra/Option.md`],
}
const STDLIB_EXTRA_EVIDENCE_MODULES: Readonly<Record<string, string>> = {
	"HashMap.md": "std.collection",
	"ArrayList.md": "std.collection",
	"File.md": "std.fs",
	"Regex.md": "std.regex",
	"Time.md": "std.time",
	"Process.md": "std.process",
	"Option.md": "std.core",
}
const STDLIB_MANUAL_EVIDENCE_MODULES: ReadonlyArray<[RegExp, string]> = [
	[/\/manual\/source_zh_cn\/basic_programming_concepts\/basic_operators\.md$/i, "std.core"],
	[/\/manual\/source_zh_cn\/enum_and_pattern_match\/option_type\.md$/i, "std.core"],
	[/\/manual\/source_zh_cn\/error_handle\/use_option\.md$/i, "std.core"],
	[/\/manual\/source_zh_cn\/generic\/generic_enum\.md$/i, "std.core"],
]
const STD_MODULES_REQUIRING_EXTERNAL_EVIDENCE = new Set([
	"std.collection",
	"std.fs",
	"std.net",
	"std.sync",
	"std.regex",
	"std.time",
	"std.process",
	"std.core",
])
const COMPLETION_EVIDENCE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/\b(?:File\.readFrom|File\.writeTo|readTextFile|String\.fromUtf8)\b/i, "std.fs"],
	[/\b(?:Regex|MatchData|matchString|findAll|replaceAll)\b/i, "std.regex"],
	[/\b(?:DateTime|TimeZone|MonoTime|nowUTC)\b/i, "std.time"],
	[/\b(?:executeWithOutput|execute\(|launch\(|SubProcess|waitOutput)\b/i, "std.process"],
	[/\b(?:HashMap|HashSet|ArrayList|TreeMap)\b/i, "std.collection"],
	[
		/\b(?:Option<|\?V\b|\?T\b|Some\(|case\s+Some|case\s+None|\bNone\b|getOrThrow|getOrDefault|isSome|isNone)\b/i,
		"std.core",
	],
]
const CANGJIE_CONTEXT_INJECTION_REPORT_RE =
	/\bCangjie context injection (?:audit|list)\b|Cangjie\s+\u4e0a\u4e0b\u6587\u6ce8\u5165(?:\u5ba1\u8ba1|\u6e05\u5355)|\u4e0a\u4e0b\u6587\u6ce8\u5165(?:\u5ba1\u8ba1|\u6e05\u5355)|Cangjie\s+涓婁笅鏂囨敞鍏/i
const CANGJIE_CONTEXT_LABEL_HINTS = [
	"toolchain-rules",
	"project-overview",
	"visible-editor-symbols",
	"stdlib-signature-hints",
	"import-to-corpus-doc-map",
	"contextual-coding-rules",
	"structured-editing-context",
	"mandatory-corpus-footer",
] as const
const CANGJIE_CONTEXT_REPORT_API_ASSERTION_RE =
	/\bCangjie evidence audit\b|corpus read:|\bAPI\s+(?:usage|correctness|correct)\b|implementation is correct|\u8bed\u6599\u8bc1\u636e|\u7528\u6cd5[\s\S]{0,80}\u6b63\u786e|\u5b9e\u73b0[\s\S]{0,80}\u6b63\u786e|\u6b63\u786e\u6027/i
const CANGJIE_CONTEXT_NEGATED_SCOPE_STATUS_RE =
	/(?:未|没有|无需|不)(?:读取|查看|分析|展开|列出|修改)[^。\n]*(?:项目状态|当前项目状态|目录结构|源文件|源文件清单|当前编辑上下文|符号|符号定义|包结构|project status|directory tree|source files?|source-file list|current symbols?|current editing context|package structure)[^。\n]*(?:。|\n|$)/gi
const CANGJIE_CONTEXT_SCOPE_EXTRA_RE =
	/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:project status|directory tree|source files?|source-file list|current symbols?|current editing context|package structure|\u9879\u76ee\u72b6\u6001|\u5f53\u524d\u9879\u76ee\u72b6\u6001|\u76ee\u5f55\u7ed3\u6784|\u6e90\u6587\u4ef6|\u6e90\u6587\u4ef6\u6e05\u5355|\u5f53\u524d\u7f16\u8f91\u4e0a\u4e0b\u6587|\u7b26\u53f7|\u7b26\u53f7\u5b9a\u4e49|\u5305\u7ed3\u6784|椤圭洰鐘舵|鐩綍缁撴瀯|婧愭枃浠|褰撳墠缂栬緫|绗﹀彿|鍖呯粨鏋)\s*(?:\*\*)?\s*[:：]?/im
const UNSUPPORTED_FILE_TEXT_RISK_RE =
	/(?:File\.readFrom|readTextFile|String\.fromUtf8)[\s\S]{0,600}(?:type mismatch|类型不匹配|类型兼容|Byte\s*(?:与|and|\/)\s*UInt8|UInt8\s*(?:与|and|\/)\s*Byte|隐式转换|type compatibility|potential risk|潜在风险|可能存在|需要确认)/i
const ALLOWLIST_EXTRA_PROBE_REPORT_RE =
	/(?:check(?:ing)? (?:the )?(?:current directory|project structure)|check whether cjpm\.toml exists|confirm(?:ing)? (?:the )?(?:project|cjpm project)|检查当前目录|检查当前项目结构|检查当前目录下是否有\s*cjpm\.toml|确认工程存在|确认项目存在)/i
const INVALID_OPTION_DEFAULT_CALL_RE =
	/\bgetOrThrow\s*\(\s*(?:[-+]?\d|["']|true\b|false\b|None\b|Some\b|default|defaultValue|other\s*:)/i
const HASHMAP_COUNT_GET_OR_THROW_RE =
	/(?:HashMap|countWords|计数|统计|璁℃暟|缁熻)[\s\S]{0,1600}\b(?:map|counts)\.get\s*\([^)]+\)\.getOrThrow\s*\(\s*\)\s*\+\s*1/i
const INCORRECT_REGEX_FIND_SIGNATURE_RE = /(?:public\s+func\s+)?find\s*\(\s*\)\s*:\s*Option<MatchData>/i
const EVIDENCE_ONLY_REPORT_RE =
	/(?:Cangjie evidence audit|evidence collected|evidence report|investigation report|证据收集|调查报告)[\s\S]{0,1600}(?:no files were modified|without modifying files|did not modify files|未修改任何文件|未修改文件)/i
const EVIDENCE_REPORT_INVITATION_RE =
	/(?:tell me if you want|if you want implementation|if you confirm|waiting for user instruction|awaiting user instruction|should I continue|请告诉我|如需开始编写代码|如果需要我可以|等待用户指令|等待指令|是否继续)/i
const HASHMAP_SUBSCRIPT_ASSIGNMENT_RE = /\b(?:counts|map)\s*\[[^\]\n]+\]\s*=/i
const HASHMAP_SUBSCRIPT_ASSIGNMENT_EVIDENCE_RE =
	/(?:operator\s+(?:func\s+)?\[\]\s*\(\s*(?:key:\s*)?K\s*,\s*(?:value!:\s*)?V\s*\)|subscript assignment operator|下标赋值|1731|1734)/i
const HASHMAP_MUTABILITY_CLAIM_RE =
	/(?:\badd\b[\s\S]{0,120}\bmut\s+(?:method|func|function)\b|\bHashMap\.add\b[\s\S]{0,160}\brequires\s+var\b|\b(?:must|cannot|can't)\b[\s\S]{0,120}\b(?:var|let)\b[\s\S]{0,120}\bHashMap\.add\b|add 是 mut|add 为 mut|add (?:不是|不可能是) mut|add 方法要求实例为 var|add 方法需要 var|必须使用 var|不能使用 let)/i
const HASHMAP_MUTABILITY_CLAIM_ZH_RE =
	/(?:add\s*是\s*mut|add\s*为\s*mut|add\s*必须(?:通过|用|使用)?\s*var|add\s*方法要求实例为\s*var|add\s*方法需要\s*var|HashMap\s*变量必须用\s*var|必须用\s*var\s*声明|必须使用\s*var|必须通过\s*var\s*绑定|必须\s*var|要求变量绑定为\s*var|修改操作要求变量绑定为\s*var|可以断言[:：]?\s*(?:add\s*必须\s*var|var\s*是\s*必(?:需|须)的)|不能使用\s*let|不能用\s*let|let\s*绑定[\s\S]{0,80}(?:不可|不能)调用|add\s+蹇呴』\s+var|var\s+鏄繀闇€|鍙互鏂█\s+var|鍙浠ユ柇瑷€\s+var|蹇呴』鐢?\s*var|蹇呴』鐢?var|蹇呴』\s*var|mutating|mut\s+鏂规硶)/i
const HASHMAP_MUTABILITY_LET_CLAIM_RE =
	/(?:let\s+(?:map|counts)\s*=\s*HashMap[\s\S]{0,240}(?:map|counts)\.(?:add|remove|clear)\s*\(|let\s+绑定[\s\S]{0,120}(?:可以|足以|可)\s*调用[\s\S]{0,80}(?:add|下标赋值|修改)|let\s*(?:可|可以|足以)\s*(?:调|调用|执行)\s*add|let\s*(?:就)?\s*足够|let\s*也(?:可|可以|可行)|let\s*即可|引用类型[\s\S]{0,160}let[\s\S]{0,120}(?:add|修改|调用)|(?:let|var)\s*更(?:简洁|推荐)|let\s*更(?:简洁|推荐)|不需要\s*var|var\s*不必要|var\s*是可选风格|两种绑定方式[\s\S]{0,80}均可|let\s*绑定不可变引用但可以调用|let\s+can\s+call\s+add|let\s+is\s+recommended|var\s+is\s+unnecessary)/i
const HASHMAP_MUTABILITY_EVIDENCE_RE = /(?:compiler diagnostic|compile diagnostic|not claim|不要声称)/i
const COMMAND_SURFACE_GUIDANCE = [
	"build/check: cjpm build, cjpm check, cjc",
	"format: cjfmt",
	"lint: cjlint",
	"debug/profile: cjdb, cjprof",
	"read-only investigation: rg, Get-ChildItem, Get-Content, Select-String, ls, cat, pwd, where.exe cjpm (cmd), Get-Command cjpm (PowerShell)",
].join("; ")
const HASHMAP_MUTABILITY_LET_CLAIM_TEXT_RE =
	/(?:let\s+绑定[\s\S]{0,120}(?:可以|足以|即可|调用)[\s\S]{0,80}(?:add|下标赋值|修改)|let\s+而非\s+var|let\s+更(?:简洁|推荐)|不需要\s*var|var\s*(?:不必要|是可选)|add\s+不是\s+mut|add\s+不需要\s+var|不能断言\s+`?add`?\s+必须\s+`?var`?|涓嶆槸[\s\S]{0,20}mut|涓嶉渶瑕[\s\S]{0,20}var|涓嶈兘鏂█[\s\S]{0,60}add[\s\S]{0,30}蹇呴』[\s\S]{0,30}var|let[\s\S]{0,40}鍗冲彲|let[\s\S]{0,60}璋冪敤[\s\S]{0,40}add)/i

const HASHMAP_MUTABILITY_NORMAL_TEXT_RE =
	/(?:add\s*(?:\u662f|\u4e3a)\s*mut|(?:add|get|contains)[\s\S]{0,120}(?:\u6ca1\u6709|\u65e0)\s*mut\s*(?:\u4fee\u9970|\u4fee\u9970\u7b26)?|add[\s\S]{0,80}(?:\u5fc5\u987b|\u9700\u8981)[\s\S]{0,40}var|HashMap[\s\S]{0,80}(?:\u53d8\u91cf|\u5b9e\u4f8b)?[\s\S]{0,40}(?:\u5fc5\u987b|\u9700\u8981|\u8981\u6c42)[\s\S]{0,40}var|\u5fc5\u987b[\s\S]{0,40}var|\u4e0d\u80fd[\s\S]{0,80}let|let[\s\S]{0,160}(?:\u7ed1\u5b9a)?[\s\S]{0,80}(?:\u5373\u53ef|\u8db3\u591f|\u53ef\u4ee5|\u53ef\u8c03|\u4e5f\u53ef\u884c|\u4e5f\u53ef\u4ee5)(?:[\s\S]{0,100}add)?|let[\s\S]{0,120}(?:\u63a8\u8350|\u66f4\u7b80\u6d01)|(?:\u4e0d\u9700\u8981|\u65e0\u9700)\s*var|var[\s\S]{0,40}(?:\u4e0d\u5fc5\u8981|\u53ef\u9009)|var\s+is\s+optional|two binding styles (?:are )?valid|let\/var[\s\S]{0,80}(?:both|valid|optional)|(?:let|var)[\s\S]{0,80}(?:\u4e24\u79cd|\u5747\u53ef|\u90fd\u53ef|\u90fd\u662f))/i
const HASHMAP_MUTABILITY_NORMAL_EVIDENCE_RE =
	/(?:do not claim|not claim|unless .*compiler|unless .*API|\u4e0d\u8981\u58f0\u79f0|\u4e0d\u5e94\u65ad\u8a00|\u4e0d\u80fd\u65ad\u8a00|\u6837\u672c\u98ce\u683c)/i
const HASHMAP_MUTABILITY_UNSAFE_RECOMMENDATION_RE =
	/(?:\u63a8\u8350[\s\S]{0,40}let|let[\s\S]{0,40}\u800c\u975e[\s\S]{0,20}var|let[\s\S]{0,120}(?:\u7ed1\u5b9a)?[\s\S]{0,80}(?:\u63a8\u8350|\u66f4\u7b80\u6d01|\u5373\u53ef|\u8db3\u591f)|(?:\u4e0d\u9700\u8981|\u65e0\u9700)\s*var|var[\s\S]{0,40}(?:\u4e0d\u5fc5\u8981|\u53ef\u9009)|let\s+is\s+recommended|var\s+is\s+unnecessary|var\s+is\s+optional|two binding styles (?:are )?valid|let\/var[\s\S]{0,80}(?:both|valid|optional))/i
const HASHMAP_CONTEXT_RE = /(?:\bHashMap\b|\b(?:map|counts)\.add\s*\(|\badd\s*\()/i
const ARRAYLIST_CONTEXT_RE = /\bArrayList\b/i

type EvidenceSource = "corpus_search" | "corpus_read" | "lsp_hover" | "lsp_definition" | "lsp_symbols"

interface EvidenceRecord {
	source: EvidenceSource
	key: string
	detail?: string
	createdAt: number
}

export interface CangjieBuildFailureSummary {
	errorCount: number
	firstError?: string
	firstErrorLocation?: string
	rootCauses: string[]
}

function normalizeStdModule(moduleName: string): string {
	const parts = moduleName.split(".")
	return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : moduleName
}

function splitCommandSegments(command: string): string[] {
	return command
		.split(/&&|\|\||;|\||(?<!>)&/)
		.map((segment) => segment.trim())
		.filter(Boolean)
}

function stripLeadingDirectoryChange(segment: string): string {
	if (/^[a-z]:$/i.test(segment.trim())) return ""
	return segment
		.replace(/^(?:cd|chdir)\s+(?:\/d\s+)?[^&|;]+$/i, "")
		.replace(/^Set-Location\s+[^&|;]+$/i, "")
		.trim()
}

function extractStdModuleFromCorpusPath(filePath: string): string | undefined {
	const normalized = filePath.replace(/\\/g, "/")
	const marker = "/libs/std/"
	const idx = normalized.indexOf(marker)
	if (idx >= 0) {
		const after = normalized.slice(idx + marker.length)
		const moduleName = after.split("/")[0]
		return moduleName ? `std.${moduleName}` : undefined
	}
	const extraMatch = normalized.match(/\/extra\/([^/]+\.md)$/i)
	const extraFileName = extraMatch?.[1]
	if (extraFileName) {
		return STDLIB_EXTRA_EVIDENCE_MODULES[extraFileName]
	}
	return STDLIB_MANUAL_EVIDENCE_MODULES.find(([pattern]) => pattern.test(normalized))?.[1]
}

function hasInlineStdModuleEvidence(resultText: string, moduleName: string): boolean {
	const normalizedModule = normalizeStdModule(moduleName)
	const normalizedText = resultText.replace(/\\/g, "/")
	const manualEvidencePaths: Readonly<Record<string, string[]>> = {
		"std.core": [
			"manual/source_zh_cn/basic_programming_concepts/basic_operators.md",
			"manual/source_zh_cn/enum_and_pattern_match/option_type.md",
			"manual/source_zh_cn/error_handle/use_option.md",
			"manual/source_zh_cn/generic/generic_enum.md",
		],
	}
	const moduleEvidencePaths = [
		...(STDLIB_EXTRA_EVIDENCE_PATHS[normalizedModule] ?? []),
		...(manualEvidencePaths[normalizedModule] ?? []),
	]
	return moduleEvidencePaths.some((evidencePath) => normalizedText.includes(evidencePath))
}

function getContextInjectionLabelCount(resultText: string): number {
	const normalized = resultText.toLowerCase()
	return CANGJIE_CONTEXT_LABEL_HINTS.filter((label) => normalized.includes(label)).length
}

function isContextInjectionReport(resultText: string): boolean {
	return CANGJIE_CONTEXT_INJECTION_REPORT_RE.test(resultText) || getContextInjectionLabelCount(resultText) >= 3
}

function isContextInjectionOnlyReport(resultText: string): boolean {
	return isContextInjectionReport(resultText) && !CANGJIE_CONTEXT_REPORT_API_ASSERTION_RE.test(resultText)
}

function formatCorpusAuditPath(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/")
	const marker = `${CANGJIE_CORPUS_ROOT}/`
	const idx = normalized.indexOf(marker)
	return idx >= 0 ? normalized.slice(idx) : normalized
}

export function buildStdModuleEvidenceSuggestions(moduleName: string): string[] {
	const normalized = normalizeStdModule(moduleName)
	const stdRoot = normalized.split(".")[1]
	const suggestions = new Set<string>()
	if (stdRoot) {
		suggestions.add(`${CANGJIE_CORPUS_ROOT}/libs/std/${stdRoot}`)
	}
	for (const extraPath of STDLIB_EXTRA_EVIDENCE_PATHS[normalized] ?? []) {
		suggestions.add(extraPath)
	}
	return [...suggestions]
}

function normalizeRelPath(relPath: string): string {
	return relPath.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function inferPackageForProjectPath(relPath: string, srcDir: string, rootPackageName?: string): string | null {
	const normalized = normalizeRelPath(relPath)
	const normalizedSrcDir = normalizeRelPath(srcDir).replace(/\/+$/, "") || "src"
	const prefix = `${normalizedSrcDir}/`
	if (!normalized.startsWith(prefix)) return null
	const afterSrc = normalized.slice(prefix.length)
	const parts = afterSrc.split("/").filter(Boolean)
	if (parts.length <= 1) {
		return rootPackageName || null
	}
	return [rootPackageName, ...parts.slice(0, -1)].filter(Boolean).join(".")
}

function countCompilerErrors(output: string): number {
	const errorLines = output
		.split(/\r?\n/)
		.filter((line) => /\berror\b|错误|鍑洪敊/i.test(line) && !/warning|note:/i.test(line))
	return errorLines.length > 0 ? errorLines.length : output.trim() ? 1 : 0
}

function summarizeBuildRootCauses(output: string): string[] {
	const byPattern = getMatchingCjcPatternsByCategory(output)
	if (byPattern.length > 0) {
		return [...new Set(byPattern.map((pattern) => pattern.category))].slice(0, 4)
	}

	const fallback: Array<[RegExp, string]> = [
		[
			/Cannot extend inline table|parse the .*cjpm\.toml.*failed|cjpm\.toml.*parse/i,
			"cjpm-toml-inline-table-error",
		],
		[/undeclared|not found|cannot find|未声明|未找到/i, "missing symbol or import"],
		[/package.*mismatch|package.*directory|包.*不一致/i, "package declaration mismatch"],
		[/type mismatch|类型不匹配|expected .* found/i, "type mismatch"],
		[/mut func|cannot call mut|let.*mut/i, "let or mut misuse"],
		[/non-exhaustive|match.*missing|match.*不穷尽/i, "non-exhaustive match"],
	]
	const causes = fallback.filter(([regex]) => regex.test(output)).map(([, label]) => label)
	return causes.length > 0 ? causes.slice(0, 4) : ["unknown compile failure"]
}

function normalizeDiagnosticLine(line: string): string {
	return line.replace(/\s+/g, " ").trim().slice(0, 220)
}

function formatAuditDetail(detail: string | undefined): string {
	if (!detail) return ""
	const normalized = detail.replace(/\s+/g, " ").trim()
	return normalized ? ` (${normalized.slice(0, 140)})` : ""
}

function formatEvidenceSource(source: EvidenceSource): string {
	switch (source) {
		case "corpus_search":
			return "corpus search"
		case "corpus_read":
			return "corpus read"
		case "lsp_hover":
			return "LSP hover"
		case "lsp_definition":
			return "LSP definition"
		case "lsp_symbols":
			return "LSP symbols"
	}
}

function extractFirstCompilerError(output: string): string | undefined {
	const lines = output.split(/\r?\n/).map(normalizeDiagnosticLine).filter(Boolean)
	const important = lines.find(
		(line) =>
			!/^warning\b|^# note\b|^note:/i.test(line) &&
			/(?:\berror\b|cannot|failed|invalid|mismatch|undeclared|not found|expected|parse)/i.test(line),
	)
	return important ?? lines[0]
}

function extractFirstCompilerErrorLocation(output: string): string | undefined {
	const lines = output.split(/\r?\n/).map(normalizeDiagnosticLine).filter(Boolean)
	for (const line of lines) {
		const arrowMatch = line.match(/==>\s+(.+?\.cj):(\d+):(\d+):?$/i)
		if (arrowMatch) {
			return `${arrowMatch[1]}:${arrowMatch[2]}:${arrowMatch[3]}`
		}
		const plainMatch = line.match(/((?:[a-z]:)?[^:\s]+\.cj):(\d+):(\d+)/i)
		if (plainMatch) {
			return `${plainMatch[1]}:${plainMatch[2]}:${plainMatch[3]}`
		}
	}
	return undefined
}

export function summarizeCangjieBuildFailure(output: string): CangjieBuildFailureSummary {
	return {
		errorCount: countCompilerErrors(output),
		firstError: extractFirstCompilerError(output),
		firstErrorLocation: extractFirstCompilerErrorLocation(output),
		rootCauses: summarizeBuildRootCauses(output),
	}
}

export function isAllowedCangjieCommand(command: string): boolean {
	if (/^\s*powershell(?:\.exe)?\b/i.test(command)) {
		return false
	}
	const segments = splitCommandSegments(command)
	if (segments.length === 0) return false
	if (segments.some((segment) => CANGJIE_DIRECT_TOOLCHAIN_RE.test(segment))) {
		return segments.every((segment) => CANGJIE_DIRECT_TOOLCHAIN_RE.test(segment))
	}

	return segments.every((segment) => {
		const stripped = stripLeadingDirectoryChange(segment)
		if (!stripped) return true
		return ALLOWED_SEGMENT_PREFIXES.some((prefix) => stripped.startsWith(prefix))
	})
}

export class CangjieRuntimePolicy {
	private projectCache: { hasProject: boolean; checkedAt: number } | null = null
	private writeRevision = 0
	private validatedRevision = 0
	private recentBuildSucceeded = true
	private recentBuildFailed = false
	private recentBuildFailureOutput: string | undefined
	private recentBuildFailureSummary: CangjieBuildFailureSummary | undefined
	private recentBuildRootCauses: string[] = []
	private recentBuildCommand: string | undefined
	private pendingEvidenceModules = new Set<string>()
	private compileFailureRounds = 0
	private stagnantFailureRounds = 0
	private previousFailureSignature: string | undefined
	private previousFailureErrorCount: number | undefined
	private repairDirective: string | undefined
	private evidenceRevision = 0
	private latestFailureEvidenceRevision = 0
	private delegatedAgentTypes: string[] = []
	private agentRouteKey: string | undefined
	private requiredAgentStages: CangjieAgentStage[] = []
	private verificationOnlyRoute = false
	private sourceDeletionAllowed = false

	readonly searchedStdModules = new Set<string>()
	readonly corpusReadModules = new Set<string>()
	readonly corpusReadPaths = new Set<string>()
	readonly queryMemo = new Set<string>()
	readonly evidenceRecords = new Map<string, EvidenceRecord>()

	constructor(private readonly cwd: string) {}

	configureAgentRoute(userMessage: string | undefined): void {
		const routeKey = userMessage?.trim()
		if (!routeKey || routeKey === this.agentRouteKey) return
		this.agentRouteKey = routeKey
		this.sourceDeletionAllowed = SOURCE_DELETE_REQUEST_RE.test(routeKey)
		this.requiredAgentStages = routeCangjieAgentTask(routeKey).stages
		this.delegatedAgentTypes = []
		this.verificationOnlyRoute = VERIFICATION_ONLY_RE.test(routeKey) && !REPAIR_REQUEST_RE.test(routeKey)
	}

	getSourceDeletionBlockReason(relPath: string): string | null {
		if (!relPath.toLowerCase().endsWith(".cj") || this.sourceDeletionAllowed) return null
		return (
			`Cangjie source deletion blocked for ${relPath}: the user did not explicitly request deleting or removing source files. ` +
			"Repair the compiler error with a narrow edit instead of making the build pass by removing code."
		)
	}

	validateAgentStageToolUse(
		toolName: string,
		params: Record<string, unknown> = {},
		isDelegatedContext = false,
	): string | null {
		if (isDelegatedContext || this.requiredAgentStages.length === 0) return null
		const requiredStages = this.getEffectiveRequiredAgentStages()
		const nextStage = requiredStages[this.delegatedAgentTypes.length]
		if (!nextStage) {
			if (
				this.recentBuildFailed &&
				(this.verificationOnlyRoute || this.isRepairLoopExhausted()) &&
				toolName !== "attempt_completion" &&
				toolName !== "update_todo_list"
			) {
				return (
					(this.verificationOnlyRoute
						? "Cangjie verification-only request completed with a failed build. "
						: `Cangjie repair loop stopped after ${MAX_REPAIR_ATTEMPTS} repair attempts with the build still failing. `) +
					"Do not delegate another agent or edit again; complete with the remaining compiler diagnostics."
				)
			}
			return null
		}

		if (toolName === "agent") {
			const requestedStage = typeof params.agentType === "string" ? params.agentType : "custom"
			return requestedStage === nextStage
				? null
				: `Cangjie agent route requires agentType "${nextStage}" next; received "${requestedStage}".`
		}

		if (toolName === "update_todo_list" || toolName === "ask_followup_question") return null
		return (
			`Cangjie agent route requires delegating "${nextStage}" before using "${toolName}" in the parent task. ` +
			`Call the agent tool with agentType "${nextStage}" now.`
		)
	}

	private getEffectiveRequiredAgentStages(): CangjieAgentStage[] {
		if (!this.recentBuildFailed) return [...this.requiredAgentStages]

		const stages = [...this.delegatedAgentTypes] as CangjieAgentStage[]
		if (this.verificationOnlyRoute) return stages
		const lastStage = stages.at(-1)
		if (lastStage === "CangjieRepair") {
			stages.push("CangjieVerify")
			return stages
		}
		if (this.isRepairLoopExhausted()) return stages
		if (this.stagnantFailureRounds >= 1 && lastStage !== "CangjieExplore") {
			stages.push("CangjieExplore")
		}
		stages.push("CangjieRepair", "CangjieVerify")
		return stages
	}

	async hasCjpmProject(): Promise<boolean> {
		const now = Date.now()
		if (this.projectCache && now - this.projectCache.checkedAt < PROJECT_CACHE_TTL_MS) {
			return this.projectCache.hasProject
		}
		const info = await parseCjpmToml(this.cwd).catch(() => null)
		const hasProject = Boolean(info)
		this.projectCache = { hasProject, checkedAt: now }
		return hasProject
	}

	invalidateProjectCache(): void {
		this.projectCache = null
	}

	async ensureProjectInitializedForWrite(relPath: string): Promise<string | null> {
		if (!relPath.toLowerCase().endsWith(".cj")) return null
		if (await this.hasCjpmProject()) return null
		return (
			`Cangjie mode requires a cjpm project before writing ${relPath}. ` +
			`Run a valid "cjpm init --name <name> --type=<type>" command first.`
		)
	}

	validateCommandSurface(command: string): string | null {
		if (isAllowedCangjieCommand(command)) return null
		return (
			`Command rejected in Cangjie mode: "${command}". Allowed command categories: ` +
			`${COMMAND_SURFACE_GUIDANCE}. Return to the Cangjie toolchain flow instead of running unrelated project commands.`
		)
	}

	async validateProjectStructureForWrite(relPath: string, nextContent?: string): Promise<string | null> {
		const normalized = normalizeRelPath(relPath)
		const lowerPath = normalized.toLowerCase()
		if (!lowerPath.endsWith(".cj") && !lowerPath.endsWith("cjpm.toml")) return null

		if (lowerPath.endsWith("cjpm.toml") && nextContent !== undefined) {
			const hasPackage = /^\s*\[package\]\s*$/m.test(nextContent)
			const hasWorkspace = /^\s*\[workspace\]\s*$/m.test(nextContent)
			if (hasPackage && hasWorkspace) {
				return "Invalid cjpm.toml structure: [package] and [workspace] cannot be declared in the same cjpm.toml."
			}
			return null
		}

		if (!lowerPath.endsWith(".cj")) return null
		const info = await parseCjpmToml(this.cwd).catch(() => null)
		if (!info) return null

		const projectRoots = info.isWorkspace
			? (info.members ?? []).map((member) => ({
					prefix: `${normalizeRelPath(member.path).replace(/\/+$/, "")}/${normalizeRelPath((member as { srcDir?: string }).srcDir || "src").replace(/\/+$/, "")}`,
					rootPackageName: member.name,
				}))
			: [{ prefix: normalizeRelPath(info.srcDir || "src").replace(/\/+$/, ""), rootPackageName: info.name }]

		const match = projectRoots.find(
			(root) => normalized === root.prefix || normalized.startsWith(`${root.prefix}/`),
		)
		if (!match) {
			const allowed = projectRoots.map((root) => `${root.prefix}/`).join(", ")
			return `Cangjie source files must be written under the configured source directory. Allowed source roots: ${allowed}. Target: ${relPath}.`
		}

		if (nextContent !== undefined) {
			const declared = nextContent.match(PACKAGE_DECL_RE)?.[1]
			const expected = inferPackageForProjectPath(normalized, match.prefix, match.rootPackageName)
			if (expected && declared && declared !== expected) {
				return `Invalid Cangjie package declaration for ${relPath}: declared "package ${declared}", expected "package ${expected}" from the project source layout.`
			}
			if (expected?.includes(".") && !declared) {
				return `Missing Cangjie package declaration for ${relPath}: expected "package ${expected}" from the project source layout.`
			}
		}

		return null
	}

	noteCorpusSearch(modules: string[], query?: string): void {
		for (const moduleName of modules) {
			const normalized = normalizeStdModule(moduleName)
			this.searchedStdModules.add(normalized)
			this.noteEvidence("corpus_search", normalized, query)
		}
		if (query) {
			this.queryMemo.add(query.trim().toLowerCase())
		}
	}

	noteCorpusReadPath(filePath: string): void {
		this.corpusReadPaths.add(path.resolve(filePath))
		const moduleName = extractStdModuleFromCorpusPath(filePath)
		if (moduleName) {
			const normalized = normalizeStdModule(moduleName)
			this.corpusReadModules.add(normalized)
			this.noteEvidence("corpus_read", normalized, formatCorpusAuditPath(filePath))
		}
	}

	noteLspEvidence(action: "hover" | "definition" | "symbols", key: string, detail?: string): void {
		const source: EvidenceSource =
			action === "hover" ? "lsp_hover" : action === "definition" ? "lsp_definition" : "lsp_symbols"
		this.noteEvidence(source, key.trim(), detail)
	}

	private noteEvidence(source: EvidenceSource, key: string, detail?: string): void {
		if (!key) return
		const normalizedKey = key.toLowerCase()
		const normalizedDetail = detail?.trim().toLowerCase() ?? ""
		const evidenceKey =
			source === "corpus_read" ? `${source}:${normalizedKey}:${normalizedDetail}` : `${source}:${normalizedKey}`
		this.evidenceRevision += 1
		this.evidenceRecords.set(evidenceKey, {
			source,
			key,
			detail,
			createdAt: Date.now(),
		})
	}

	hasEvidenceForStdModule(moduleName: string): boolean {
		const normalized = normalizeStdModule(moduleName)
		const hasExternalEvidence = this.searchedStdModules.has(normalized) || this.corpusReadModules.has(normalized)
		if (STD_MODULES_REQUIRING_EXTERNAL_EVIDENCE.has(normalized)) return hasExternalEvidence
		return (
			hasExternalEvidence ||
			CRITICAL_SIGNATURE_MODULES.has(normalized) ||
			SEARCH_GATE_EXEMPT_MODULES.has(normalized)
		)
	}

	getMissingImportEvidence(previousContent: string | undefined, nextContent: string): string[] {
		const previous = new Set(extractStdImports(previousContent ?? "").map(normalizeStdModule))
		const next = extractStdImports(nextContent).map(normalizeStdModule)
		return next.filter((moduleName) => !previous.has(moduleName) && !this.hasEvidenceForStdModule(moduleName))
	}

	getMissingCompletionEvidence(resultText: string): string[] {
		if (this.recentBuildSucceeded && this.recentBuildCommand) {
			return []
		}
		if (isContextInjectionOnlyReport(resultText)) {
			return []
		}
		if (
			/API correctness cannot be (?:claimed|confirmed|asserted)|cannot (?:claim|confirm|assert) API correctness|API 正确性(?:无法|不能)(?:断言|确认|验证)|无法(?:通过外部证据)?确认.*API|无法验证.*API|无法断言.*API/i.test(
				resultText,
			)
		) {
			return []
		}
		const missing = new Set<string>()
		for (const [pattern, moduleName] of COMPLETION_EVIDENCE_PATTERNS) {
			if (
				pattern.test(resultText) &&
				!this.hasEvidenceForStdModule(moduleName) &&
				!hasInlineStdModuleEvidence(resultText, moduleName)
			) {
				missing.add(moduleName)
			}
		}
		return [...missing]
	}

	getUnsupportedStdlibRiskSpeculation(resultText: string): string | null {
		if (isContextInjectionOnlyReport(resultText)) return null
		if (!UNSUPPORTED_FILE_TEXT_RISK_RE.test(resultText)) return null
		if (this.recentBuildFailed) return null
		if (/cjpm build success|build success|编译通过|编译成功/i.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report speculates about File.readFrom/String.fromUtf8 Byte/UInt8 type compatibility without a failed build diagnostic. " +
			"Read or cite the official std.fs file sample (CangjieCorpus-1.0.0/libs/std/fs/fs_samples/file_samples.md) or a successful cjpm build before calling this pattern risky."
		)
	}

	getContextInjectionAuditMissingLabelsReport(resultText: string): string | null {
		if (!CANGJIE_CONTEXT_INJECTION_REPORT_RE.test(resultText)) return null
		if (getContextInjectionLabelCount(resultText) >= 3) return null
		return (
			"Completion blocked in Cangjie mode: the final context-injection audit does not list the injected context labels. " +
			"When the user asks which Cangjie context was injected, list the actual context group labels such as `toolchain-rules`, `structured-editing-context`, and `stdlib-signature-hints`; do not answer only that the report was already submitted or completed."
		)
	}

	getContextInjectionAuditScopeReport(resultText: string): string | null {
		if (!isContextInjectionReport(resultText)) return null
		const scopeText = resultText.replace(CANGJIE_CONTEXT_NEGATED_SCOPE_STATUS_RE, "")
		if (!CANGJIE_CONTEXT_SCOPE_EXTRA_RE.test(scopeText)) return null
		return (
			"Completion blocked in Cangjie mode: the final context-injection audit includes extra project/file/symbol status. " +
			"When the user asks only which Cangjie context was injected, answer only with the injected context labels or audit list, plus a closed no-file-change status. " +
			"Do not add project status, directory trees, source-file lists, current-symbol summaries, diagnostics, API correctness, or implementation advice unless explicitly asked."
		)
	}

	getContradictoryVerificationReport(resultText: string): string | null {
		if (!/cjpm build success|build success|编译通过|编译成功/i.test(resultText)) return null
		if (!/verification inconclusive|验证不确定|无法确认.*编译|不能确认.*编译|无法判断.*编译/i.test(resultText))
			return null
		return (
			"Completion blocked in Cangjie mode: the final report says the build succeeded but also reports verification as inconclusive. " +
			"When readable toolchain output contains `cjpm build success`, report verification as passed/successful, with warnings summarized separately."
		)
	}

	getAllowlistExtraProbeReport(resultText: string): string | null {
		if (!/only run|only ran|explicit command allowlist|只运行|只执行/i.test(resultText)) return null
		if (!ALLOWLIST_EXTRA_PROBE_REPORT_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report describes extra project/file probes during an explicit command-allowlist task. " +
			"When the user says to only run specific commands, report only those command attempts and their outputs; do not claim or plan project-structure checks."
		)
	}

	getInvalidOptionDefaultCallReport(resultText: string): string | null {
		if (!INVALID_OPTION_DEFAULT_CALL_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report passes a default value to Option.getOrThrow. " +
			"`getOrThrow()` is only for values known to be Some; use `??`, `getOrDefault({ => ... })`, or match for default-value handling."
		)
	}

	getUnsafeHashMapCountGetOrThrowReport(resultText: string): string | null {
		if (!HASHMAP_COUNT_GET_OR_THROW_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report uses HashMap.get(...).getOrThrow() in a counting update where a key may be absent. " +
			"For count defaults, use `map.get(key) ?? 0`, `getOrDefault({ => 0 })`, `contains(...)`, or match on Some/None before adding 1."
		)
	}

	getIncorrectRegexFindSignatureReport(resultText: string): string | null {
		if (!INCORRECT_REGEX_FIND_SIGNATURE_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report states Regex.find as a zero-argument signature. " +
			"Use the corpus-confirmed signature `find(input: String, group!: Bool = false): Option<MatchData>`."
		)
	}

	getEvidenceReportInvitationReport(resultText: string): string | null {
		if (!EVIDENCE_ONLY_REPORT_RE.test(resultText)) return null
		if (!EVIDENCE_REPORT_INVITATION_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final evidence-only report invites immediate coding or asks the user whether to continue. " +
			"When the user requested only investigation/evidence and no file changes, end with a closed status such as `Evidence collected; no files were modified.`"
		)
	}

	getUncitedHashMapSubscriptAssignmentReport(resultText: string): string | null {
		if (!/\bHashMap\b|计数|统计/i.test(resultText)) return null
		if (!HASHMAP_SUBSCRIPT_ASSIGNMENT_RE.test(resultText)) return null
		if (HASHMAP_SUBSCRIPT_ASSIGNMENT_EVIDENCE_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report uses HashMap subscript assignment without citing its operator signature. " +
			"For count-update examples, use `get(...)` plus `add(...)` when only add/get evidence was collected, or cite `operator [](key: K, value!: V): Unit` before using `map[key] = value`."
		)
	}

	getUnsupportedHashMapMutabilityClaimReport(resultText: string): string | null {
		if (ARRAYLIST_CONTEXT_RE.test(resultText) && !/(?:\bHashMap\b|\b(?:map|counts)\.add\s*\()/i.test(resultText)) {
			return null
		}
		if (!HASHMAP_CONTEXT_RE.test(resultText)) return null
		if (
			!HASHMAP_MUTABILITY_CLAIM_RE.test(resultText) &&
			!HASHMAP_MUTABILITY_CLAIM_ZH_RE.test(resultText) &&
			!HASHMAP_MUTABILITY_LET_CLAIM_RE.test(resultText) &&
			!HASHMAP_MUTABILITY_LET_CLAIM_TEXT_RE.test(resultText) &&
			!HASHMAP_MUTABILITY_NORMAL_TEXT_RE.test(resultText)
		) {
			return null
		}
		if (
			HASHMAP_MUTABILITY_NORMAL_EVIDENCE_RE.test(resultText) &&
			!HASHMAP_MUTABILITY_UNSAFE_RECOMMENDATION_RE.test(resultText)
		)
			return null
		if (HASHMAP_MUTABILITY_EVIDENCE_RE.test(resultText)) return null
		return (
			"Completion blocked in Cangjie mode: the final report makes an unsupported HashMap.add let/var mutability claim. " +
			"HashMap.add is documented as `public func add(...)`; use `var` to follow samples if needed, but do not claim `var` is required, `let` is valid/recommended, or `let` cannot call add unless a compiler diagnostic or API signature proves it. " +
			"To pass this gate, remove the entire let/var mutability discussion, remove let-based add examples, and write only: `var follows the samples; no let/var semantic conclusion is made here.`"
		)
	}

	noteWriteApplied(relPath: string, previousContent: string | undefined, nextContent: string | undefined): void {
		const lowerPath = relPath.toLowerCase()
		const affectsBuild = lowerPath.endsWith(".cj") || lowerPath.endsWith(".toml")
		if (!affectsBuild) return

		this.writeRevision += 1
		this.recentBuildSucceeded = false
		this.recentBuildFailed = false
		this.recentBuildFailureOutput = undefined
		this.recentBuildFailureSummary = undefined
		this.recentBuildRootCauses = []
		this.repairDirective = undefined

		if (lowerPath.endsWith(".cj") && nextContent !== undefined) {
			for (const moduleName of this.getMissingImportEvidence(previousContent, nextContent)) {
				this.pendingEvidenceModules.add(moduleName)
			}
		}
		if (lowerPath.endsWith("cjpm.toml")) {
			this.invalidateProjectCache()
		}
	}

	notePathDeleted(relPath: string): void {
		const lowerPath = relPath.toLowerCase()
		if (!lowerPath.endsWith(".cj") && !lowerPath.endsWith(".toml")) return
		this.writeRevision += 1
		this.recentBuildSucceeded = false
		this.recentBuildFailed = false
		this.recentBuildFailureOutput = undefined
		this.recentBuildFailureSummary = undefined
		this.recentBuildRootCauses = []
		this.repairDirective = undefined
	}

	noteBuildResult(command: string, succeeded: boolean, output: string): void {
		if (INIT_COMMAND_RE.test(command) && succeeded) {
			this.noteWriteApplied("cjpm.toml", undefined, "")
		}
		if (!BUILD_COMMAND_RE.test(command)) return

		this.recentBuildCommand = command
		this.recentBuildSucceeded = succeeded
		this.recentBuildFailed = !succeeded

		if (succeeded) {
			this.validatedRevision = this.writeRevision
			this.recentBuildFailureOutput = undefined
			this.recentBuildFailureSummary = undefined
			this.recentBuildRootCauses = []
			this.pendingEvidenceModules.clear()
			this.compileFailureRounds = 0
			this.stagnantFailureRounds = 0
			this.previousFailureSignature = undefined
			this.previousFailureErrorCount = undefined
			this.repairDirective = undefined
			return
		}

		this.recentBuildFailureOutput = output
		this.recentBuildFailureSummary = summarizeCangjieBuildFailure(output)
		this.recentBuildRootCauses = this.recentBuildFailureSummary.rootCauses
		this.compileFailureRounds += 1
		const signature = this.recentBuildRootCauses.join("|")
		const errorCount = this.recentBuildFailureSummary.errorCount
		if (
			this.previousFailureSignature === signature &&
			this.previousFailureErrorCount !== undefined &&
			errorCount >= this.previousFailureErrorCount
		) {
			this.stagnantFailureRounds += 1
		} else {
			this.stagnantFailureRounds = 0
		}
		this.previousFailureSignature = signature
		this.previousFailureErrorCount = errorCount
		this.latestFailureEvidenceRevision = this.evidenceRevision
		this.repairDirective = this.buildRepairDirective(errorCount)
	}

	getStagnantRepairWriteBlockReason(relPath: string): string | null {
		const lowerPath = relPath.toLowerCase()
		if (!lowerPath.endsWith(".cj") && !lowerPath.endsWith(".toml")) return null
		if (!this.recentBuildFailed || this.stagnantFailureRounds < 1) return null
		if (this.evidenceRevision > this.latestFailureEvidenceRevision) return null

		const rootCauses =
			this.recentBuildRootCauses.length > 0
				? ` Latest root causes: ${this.recentBuildRootCauses.join(", ")}.`
				: ""
		return (
			`Cangjie repair is stagnant: diagnostics did not improve after ${this.compileFailureRounds} failed build rounds.` +
			rootCauses +
			` Gather fresh corpus/LSP evidence for the latest failure before editing ${relPath} again.`
		)
	}

	private buildRepairDirective(errorCount: number): string {
		const rootCauses = this.recentBuildRootCauses.slice(0, 2)
		const focus = rootCauses.length > 0 ? rootCauses.join(", ") : "the first compiler error"
		const firstError = this.recentBuildFailureSummary?.firstError
			? ` First error: ${this.recentBuildFailureSummary.firstError}.`
			: ""
		const firstErrorLocation = this.recentBuildFailureSummary?.firstErrorLocation
			? ` First error location: ${this.recentBuildFailureSummary.firstErrorLocation}.`
			: ""
		const fallback =
			this.stagnantFailureRounds >= 1
				? "\nFallback required: diagnostics did not improve. Read the directly affected files and gather corpus/LSP evidence before editing again."
				: ""
		return (
			`Cangjie compile-repair directive: fix only the top root cause(s) this round: ${focus}. ` +
			`Current compiler error estimate: ${errorCount}.${firstError}${firstErrorLocation} Re-run cjpm build after the edit and compare diagnostics before attempting completion.` +
			fallback
		)
	}

	private formatMissingEvidenceGuidance(): string {
		const modules = [...this.pendingEvidenceModules]
		const suggestions = modules.flatMap((moduleName) =>
			buildStdModuleEvidenceSuggestions(moduleName).map((suggestion) => `- ${moduleName}: ${suggestion}`),
		)
		if (suggestions.length === 0) return ""
		return ` Suggested corpus locations:\n${suggestions.join("\n")}`
	}

	private formatBuildFailureStatus(): string {
		const parts = [
			this.recentBuildCommand ? `command: ${this.recentBuildCommand}` : undefined,
			`failure rounds: ${this.compileFailureRounds}`,
			`stagnant rounds: ${this.stagnantFailureRounds}`,
		].filter(Boolean)
		return parts.length > 0 ? ` Build status: ${parts.join("; ")}.` : ""
	}

	private formatPendingBuildGuidance(): string {
		return " Run `cjpm build` before completing; use `cjpm check` first only if you need a faster diagnostic pass."
	}

	getAttemptCompletionBlockReason(
		options: { allowPendingBuild?: boolean; allowFailedBuildHandoff?: boolean } = {},
	): string | null {
		if (this.pendingEvidenceModules.size > 0) {
			return (
				`Completion blocked in Cangjie mode: missing stdlib evidence for ${[...this.pendingEvidenceModules].join(", ")}. ` +
				`Search or read the bundled Cangjie corpus before finishing.` +
				this.formatMissingEvidenceGuidance()
			)
		}
		if (this.writeRevision > this.validatedRevision && !options.allowPendingBuild) {
			return (
				"Completion blocked in Cangjie mode: Cangjie source or cjpm.toml changed after the last successful build." +
				this.formatPendingBuildGuidance()
			)
		}
		if (
			this.recentBuildFailed &&
			!options.allowFailedBuildHandoff &&
			!this.verificationOnlyRoute &&
			!this.isRepairLoopExhausted()
		) {
			const causeSummary =
				this.recentBuildRootCauses.length > 0
					? ` Recent root causes: ${this.recentBuildRootCauses.join(", ")}.`
					: ""
			const firstError = this.recentBuildFailureSummary?.firstError
				? ` First error: ${this.recentBuildFailureSummary.firstError}.`
				: ""
			const firstErrorLocation = this.recentBuildFailureSummary?.firstErrorLocation
				? ` First error location: ${this.recentBuildFailureSummary.firstErrorLocation}.`
				: ""
			const directive = this.repairDirective ? ` ${this.repairDirective}` : ""
			return `Completion blocked in Cangjie mode: the latest build failed.${causeSummary}${firstError}${firstErrorLocation}${this.formatBuildFailureStatus()}${directive}`
		}
		return null
	}

	getContextIntensity(turnIndex: number): CangjieContextIntensity {
		if (this.recentBuildFailed || this.pendingEvidenceModules.size > 0) return "full"
		if (this.writeRevision > this.validatedRevision) return "full"
		return turnIndex > 0 ? "compact" : "full"
	}

	getRecentBuildRootCauses(): string[] {
		return [...this.recentBuildRootCauses]
	}

	getRecentBuildFailureOutput(): string | undefined {
		return this.recentBuildFailureOutput
	}

	getRecentBuildFailureSummary(): CangjieBuildFailureSummary | undefined {
		return this.recentBuildFailureSummary
			? {
					...this.recentBuildFailureSummary,
					rootCauses: [...this.recentBuildFailureSummary.rootCauses],
				}
			: undefined
	}

	getEvidenceAuditSummary(limit = 6): string | undefined {
		const records = [...this.evidenceRecords.values()]
			.sort((a, b) => a.createdAt - b.createdAt)
			.slice(-Math.max(1, limit))
		if (records.length === 0) return undefined
		return [
			"Cangjie evidence audit:",
			...records.map(
				(record) =>
					`- ${formatEvidenceSource(record.source)}: ${record.key}${formatAuditDetail(record.detail)}`,
			),
		].join("\n")
	}

	getRecentBuildCommand(): string | undefined {
		return this.recentBuildCommand
	}

	getRepairDirective(): string | undefined {
		return this.verificationOnlyRoute || this.isRepairLoopExhausted() ? undefined : this.repairDirective
	}

	getCompileFailureRounds(): number {
		return this.compileFailureRounds
	}

	getStagnantFailureRounds(): number {
		return this.stagnantFailureRounds
	}

	private getRepairAttemptCount(): number {
		return this.delegatedAgentTypes.filter((agentType) => agentType === "CangjieRepair").length
	}

	private isRepairLoopExhausted(): boolean {
		return this.getRepairAttemptCount() >= MAX_REPAIR_ATTEMPTS
	}

	noteAgentDelegation(agentType: string): void {
		this.delegatedAgentTypes.push(agentType)
	}

	getDelegatedAgentTypes(): string[] {
		return [...this.delegatedAgentTypes]
	}

	getEvalRuntimeSnapshot() {
		return {
			writeRevision: this.writeRevision,
			validatedRevision: this.validatedRevision,
			recentBuildSucceeded: this.recentBuildSucceeded,
			recentBuildFailed: this.recentBuildFailed,
			compileFailureRounds: this.compileFailureRounds,
			stagnantFailureRounds: this.stagnantFailureRounds,
			searchedStdModules: [...this.searchedStdModules].sort(),
			corpusReadModules: [...this.corpusReadModules].sort(),
			corpusReadPathCount: this.corpusReadPaths.size,
			pendingEvidenceModules: [...this.pendingEvidenceModules].sort(),
			evidenceRecordCount: this.evidenceRecords.size,
			recentBuildCommand: this.recentBuildCommand,
			delegatedAgentTypes: [...this.delegatedAgentTypes],
			repairAttemptCount: this.getRepairAttemptCount(),
			repairLoopExhausted: this.isRepairLoopExhausted(),
			verificationOnlyRoute: this.verificationOnlyRoute,
		}
	}
}
