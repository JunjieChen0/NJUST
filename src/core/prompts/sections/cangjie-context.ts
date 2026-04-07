import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { NJUST_AI_CONFIG_DIR } from "@njust-ai-cj/types"
import {
	parseCangjieDefinitions,
	computeCangjieSignature,
	extractTypeMemberSummaries,
	type CangjieDef,
} from "../../../services/tree-sitter/cangjieParser"
import { CangjieSymbolIndex, type SymbolEntry } from "../../../services/cangjie-lsp/CangjieSymbolIndex"
import { getBundledCangjieCorpusPath } from "../../../utils/bundledCangjieCorpus"

const LEARNED_FIXES_FILE = "learned-fixes.json"
const LEARNED_FIXES_MAX_SECTION_CHARS = 4000

interface LearnedFixPattern {
	errorPattern: string
	fix: string
	projectSpecific?: boolean
	occurrences?: number
}

const IMPORT_REGEX = /^\s*import\s+([\w.]+)\.\*?\s*$/gm
const FROM_IMPORT_REGEX = /^\s*from\s+([\w.]+)\s+import\s+/gm
const PACKAGE_DECL_REGEX = /^\s*package\s+([\w.]+)\s*$/m

interface DocMapping {
	prefix: string
	docPaths: string[]
	summary: string
}

const STDLIB_DOC_MAP: DocMapping[] = [
	{ prefix: "std.collection", docPaths: ["libs/std/collection/", "manual/source_zh_cn/collections/"], summary: "ArrayList, HashMap, HashSet 等集合类型" },
	{ prefix: "std.io", docPaths: ["libs/std/io/", "manual/source_zh_cn/Basic_IO/"], summary: "流式 IO、文件读写" },
	{ prefix: "std.fs", docPaths: ["libs/std/fs/"], summary: "文件系统操作" },
	{ prefix: "std.net", docPaths: ["libs/std/net/", "manual/source_zh_cn/Net/"], summary: "HTTP/Socket/WebSocket 网络编程" },
	{ prefix: "std.sync", docPaths: ["libs/std/sync/", "manual/source_zh_cn/concurrency/"], summary: "Mutex、AtomicInt 等并发同步原语" },
	{ prefix: "std.time", docPaths: ["libs/std/time/"], summary: "日期时间处理" },
	{ prefix: "std.math", docPaths: ["libs/std/math/"], summary: "数学运算" },
	{ prefix: "std.regex", docPaths: ["libs/std/regex/"], summary: "正则表达式" },
	{ prefix: "std.console", docPaths: ["libs/std/console/"], summary: "控制台输入输出" },
	{ prefix: "std.convert", docPaths: ["libs/std/convert/"], summary: "类型转换" },
	{ prefix: "std.unittest", docPaths: ["libs/std/unittest/"], summary: "单元测试框架 (@Test, @TestCase, @Assert)" },
	{ prefix: "std.random", docPaths: ["libs/std/random/"], summary: "随机数生成" },
	{ prefix: "std.process", docPaths: ["libs/std/process/"], summary: "进程管理" },
	{ prefix: "std.env", docPaths: ["libs/std/env/"], summary: "环境变量" },
	{ prefix: "std.reflect", docPaths: ["libs/std/reflect/", "manual/source_zh_cn/reflect_and_annotation/"], summary: "反射与注解" },
	{ prefix: "std.sort", docPaths: ["libs/std/sort/"], summary: "排序算法" },
	{ prefix: "std.binary", docPaths: ["libs/std/binary/"], summary: "二进制数据处理" },
	{ prefix: "std.ast", docPaths: ["libs/std/ast/"], summary: "AST 操作（宏编程）" },
	{ prefix: "std.crypto", docPaths: ["libs/std/crypto/"], summary: "加密与哈希" },
	{ prefix: "std.database", docPaths: ["libs/std/database/"], summary: "数据库 SQL 接口" },
	{ prefix: "std.core", docPaths: ["libs/std/core/"], summary: "核心类型与函数（自动导入）" },
	{ prefix: "std.deriving", docPaths: ["libs/std/deriving/"], summary: "自动派生宏" },
	{ prefix: "std.overflow", docPaths: ["libs/std/overflow/"], summary: "溢出安全运算" },
]

interface CjcErrorPattern {
	pattern: RegExp
	category: string
	docPaths: string[]
	suggestion: string
}

const CJC_ERROR_PATTERNS: CjcErrorPattern[] = [
	{
		pattern: /(?:undeclared|cannot find|not found|未找到符号|unresolved)/i,
		category: "未找到符号",
		docPaths: ["manual/source_zh_cn/package/import.md"],
		suggestion: "检查 import 语句是否正确，确认 cjpm.toml 中是否声明了依赖包",
	},
	{
		pattern: /(?:type mismatch|incompatible types|类型不匹配)/i,
		category: "类型不匹配",
		docPaths: ["manual/source_zh_cn/class_and_interface/typecast.md", "manual/source_zh_cn/class_and_interface/subtype.md"],
		suggestion: "检查赋值和参数的类型是否一致，必要时使用类型转换或泛型约束",
	},
	{
		pattern: /(?:cyclic dependency|循环依赖)/i,
		category: "循环依赖",
		docPaths: ["manual/source_zh_cn/package/package_overview.md"],
		suggestion: "使用 `cjpm check` 查看依赖关系图，将共享类型抽取到独立包中打破循环",
	},
	{
		pattern: /(?:immutable|cannot assign|let.*reassign|不可变)/i,
		category: "不可变变量赋值",
		docPaths: ["manual/source_zh_cn/basic_programming_concepts/expression.md"],
		suggestion: "将 `let` 改为 `var` 声明，或重新设计为不可变模式",
	},
	{
		pattern: /(?:mut function|mut.*let|let.*mut)/i,
		category: "mut 函数限制",
		docPaths: ["manual/source_zh_cn/struct/mut.md"],
		suggestion: "let 绑定的 struct 变量不能调用 mut 函数，改用 var 声明",
	},
	{
		pattern: /(?:recursive struct|recursive value type|递归结构体)/i,
		category: "递归结构体",
		docPaths: ["manual/source_zh_cn/struct/define_struct.md", "manual/source_zh_cn/class_and_interface/class.md"],
		suggestion: "struct 是值类型不能自引用，改用 class（引用类型）或 Option 包装",
	},
	{
		pattern: /(?:overflow|arithmetic.*overflow)/i,
		category: "算术溢出",
		docPaths: ["manual/source_zh_cn/error_handle/common_runtime_exceptions.md"],
		suggestion: "使用 std.overflow 包中的溢出安全运算，或检查边界条件",
	},
	{
		pattern: /(?:NoneValueException|unwrap.*None|getOrThrow)/i,
		category: "空值异常",
		docPaths: ["manual/source_zh_cn/error_handle/use_option.md", "manual/source_zh_cn/enum_and_pattern_match/option_type.md"],
		suggestion: "使用 `??` 合并运算符提供默认值，或用 match/if-let 安全解包 Option",
	},
	{
		pattern: /(?:not implement|missing implementation|未实现接口)/i,
		category: "接口未实现",
		docPaths: ["manual/source_zh_cn/class_and_interface/interface.md"],
		suggestion: "检查类是否完整实现了所有接口方法，注意方法签名必须完全匹配",
	},
	{
		pattern: /(?:access.*denied|private|protected|not accessible|访问权限)/i,
		category: "访问权限错误",
		docPaths: ["manual/source_zh_cn/package/toplevel_access.md", "manual/source_zh_cn/extension/access_rules.md"],
		suggestion: "检查成员的访问修饰符（public/protected/private/internal），跨包访问需要 public",
	},
	{
		pattern: /(?:missing return|no return|缺少返回|return expected)/i,
		category: "缺少 return 语句",
		docPaths: ["manual/source_zh_cn/function/define_functions.md"],
		suggestion: "非 Unit 返回类型的函数所有分支必须有 return 语句，或将最后一个表达式作为返回值",
	},
	{
		pattern: /(?:wrong number.*argument|too (?:many|few) argument|参数数量|arity)/i,
		category: "函数参数数量错误",
		docPaths: ["manual/source_zh_cn/function/call_functions.md"],
		suggestion: "检查函数调用的参数数量是否与声明匹配，注意命名参数需要用 `name:` 语法",
	},
	{
		pattern: /(?:missing import|import.*not found|未导入)/i,
		category: "缺少 import",
		docPaths: ["manual/source_zh_cn/package/import.md"],
		suggestion: "添加缺失的 import 语句，如 `import std.collection.*` 或 `import std.io.*`",
	},
	{
		pattern: /(?:non-exhaustive|not exhaustive|未穷尽|incomplete match)/i,
		category: "match 不穷尽",
		docPaths: ["manual/source_zh_cn/enum_and_pattern_match/match.md"],
		suggestion: "match 表达式必须覆盖所有可能的值，添加缺失的 case 分支或使用 `case _ =>` 通配",
	},
	{
		pattern: /(?:constraint.*not satisfied|does not conform|泛型约束|type parameter.*bound)/i,
		category: "泛型约束不满足",
		docPaths: ["manual/source_zh_cn/generic/generic_constraint.md"],
		suggestion: "检查类型参数是否满足 where 子句中的约束（如 `<: Comparable<T>`），必要时添加约束或换用其他类型",
	},
	{
		pattern: /(?:constructor.*argument|init.*parameter|构造.*参数)/i,
		category: "构造函数参数错误",
		docPaths: ["manual/source_zh_cn/class_and_interface/class.md", "manual/source_zh_cn/struct/create_instance.md"],
		suggestion: "检查构造函数 init 的参数列表与调用处是否匹配",
	},
	{
		pattern: /(?:duplicate.*definition|redefinition|already defined|重复定义)/i,
		category: "重复定义",
		docPaths: ["manual/source_zh_cn/basic_programming_concepts/identifier.md"],
		suggestion: "同一作用域内不能有同名定义，检查是否重复声明了变量、函数或类型",
	},
	{
		pattern: /(?:main.*signature|main.*return|main.*Int64)/i,
		category: "main 函数签名错误",
		docPaths: ["manual/source_zh_cn/basic_programming_concepts/program_structure.md"],
		suggestion: "main 函数签名必须为 `main(): Int64`，必须返回 Int64 类型",
	},
	{
		pattern: /(?:Resource.*interface|isClosed|close.*not.*implement)/i,
		category: "Resource 接口未实现",
		docPaths: ["manual/source_zh_cn/error_handle/handle.md"],
		suggestion: "try-with-resources 中的对象必须实现 Resource 接口（isClosed() 和 close() 方法）",
	},
	{
		pattern: /(?:override.*missing|must.*override|需要.*override|override.*required)/i,
		category: "缺少 override 修饰符",
		docPaths: ["manual/source_zh_cn/class_and_interface/class.md"],
		suggestion: "重写父类方法必须使用 `override` 关键字，重定义使用 `redef`",
	},
	{
		pattern: /(?:index.*out.*bound|IndexOutOfBounds|数组越界|下标越界)/i,
		category: "索引越界",
		docPaths: ["manual/source_zh_cn/error_handle/common_runtime_exceptions.md"],
		suggestion: "访问数组/字符串前检查索引范围，使用 `.size` 获取长度",
	},
	{
		pattern: /(?:capture.*mutable|spawn.*var|并发.*可变)/i,
		category: "spawn 捕获可变引用",
		docPaths: ["manual/source_zh_cn/concurrency/create_thread.md"],
		suggestion: "spawn 块内不能直接捕获可变引用，使用 Mutex/Atomic 保护共享状态",
	},
	{
		pattern: /(?:where.*clause|where.*syntax|where.*error)/i,
		category: "where 子句语法错误",
		docPaths: ["manual/source_zh_cn/generic/generic_constraint.md"],
		suggestion: "where 子句语法: `where T <: Interface`，多约束用 `&` 连接: `where T <: A & B`",
	},
	{
		pattern: /(?:prop.*getter|prop.*setter|属性.*语法)/i,
		category: "prop 语法错误",
		docPaths: ["manual/source_zh_cn/class_and_interface/prop.md"],
		suggestion: "属性语法: `prop name: Type { get() { ... } set(v) { ... } }`，只读属性可省略 set",
	},
	{
		pattern: /(?:expected.*semicolon|expected.*bracket|expected.*paren|语法错误|syntax error|unexpected token)/i,
		category: "语法解析错误",
		docPaths: ["manual/source_zh_cn/basic_programming_concepts/expression.md"],
		suggestion: "检查括号/花括号是否匹配，语句是否完整。注意仓颉不使用分号结尾（除非同一行多条语句）",
	},
]

/**
 * When the Cangjie LSP exposes stable `Diagnostic.code` values, map them here for
 * higher-precision matching than message regex alone. Unknown codes fall back to
 * matching `diagnostic.message` against `CJC_ERROR_PATTERNS`.
 */
const CJC_DIAGNOSTIC_CODE_TO_PATTERN: ReadonlyMap<string, CjcErrorPattern> = new Map([
	// Example: ["CJ0001", CJC_ERROR_PATTERNS[0]] — add when compiler codes are documented
])

function normalizeDiagnosticCode(diag: vscode.Diagnostic): string | undefined {
	const c = diag.code
	if (c === undefined || c === null) return undefined
	if (typeof c === "string" || typeof c === "number") return String(c)
	if (typeof c === "object" && c !== null && "value" in c) {
		return String((c as { value: string | number }).value)
	}
	return undefined
}

function resolveCjcPatternForDiagnostic(diag: vscode.Diagnostic): CjcErrorPattern | null {
	const code = normalizeDiagnosticCode(diag)
	if (code) {
		const byCode = CJC_DIAGNOSTIC_CODE_TO_PATTERN.get(code)
		if (byCode) return byCode
	}
	for (const pattern of CJC_ERROR_PATTERNS) {
		if (pattern.pattern.test(diag.message)) {
			return pattern
		}
	}
	return null
}

function getErrorFixDirectiveForDiagnostic(diag: vscode.Diagnostic): string {
	const resolved = resolveCjcPatternForDiagnostic(diag)
	if (resolved) return resolved.suggestion
	return getErrorFixDirective(diag.message)
}

// SYNTAX_PITFALLS and CODE_REVIEW_CHECKLIST have been removed to avoid
// duplication with the inlined CANGJIE_SYNTAX_REFERENCE and CANGJIE_CODING_RULES
// that are already injected via customInstructions in mode.ts.

// ---------------------------------------------------------------------------
// Project structure types and constants
// ---------------------------------------------------------------------------

interface CjpmProjectInfo {
	name: string
	version: string
	outputType: string
	isWorkspace: boolean
	members?: Array<{ name: string; path: string; outputType: string }>
	dependencies?: Record<string, { path?: string; git?: string; tag?: string; branch?: string }>
	srcDir: string
}

interface PackageNode {
	packageName: string
	dirPath: string
	sourceFiles: string[]
	testFiles: string[]
	hasMain: boolean
	children: PackageNode[]
}

const MAX_SCAN_DEPTH = 5
const MAX_SCAN_FILES = 500
const MAX_WORKSPACE_MEMBERS = 20

/**
 * Extract import statements from Cangjie source code.
 */
function extractImports(content: string): string[] {
	const imports: string[] = []
	let match: RegExpExecArray | null

	IMPORT_REGEX.lastIndex = 0
	while ((match = IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	FROM_IMPORT_REGEX.lastIndex = 0
	while ((match = FROM_IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	return [...new Set(imports)]
}

/**
 * Map imports to relevant documentation paths and summaries.
 */
function mapImportsToDocPaths(imports: string[]): Array<{ prefix: string; summary: string; docPaths: string[] }> {
	const results: Array<{ prefix: string; summary: string; docPaths: string[] }> = []
	const seen = new Set<string>()

	for (const imp of imports) {
		for (const mapping of STDLIB_DOC_MAP) {
			if (imp.startsWith(mapping.prefix) && !seen.has(mapping.prefix)) {
				seen.add(mapping.prefix)
				results.push(mapping)
			}
		}
	}

	return results
}

/**
 * Collect imports from all visible .cj files in the editor.
 */
function collectActiveCangjieImports(): string[] {
	const allImports: string[] = []

	for (const editor of vscode.window.visibleTextEditors) {
		if (editor.document.languageId === "cangjie" || editor.document.fileName.endsWith(".cj")) {
			const content = editor.document.getText()
			allImports.push(...extractImports(content))
		}
	}

	return [...new Set(allImports)]
}

/**
 * Collect symbol definitions from all visible .cj files for AI context.
 * Groups child definitions (functions inside classes) for readability.
 */
function collectActiveCangjieSymbols(): string | null {
	const MAX_DEFS = 30
	const fileSymbols: Array<{ fileName: string; defs: CangjieDef[] }> = []
	let totalDefs = 0

	for (const editor of vscode.window.visibleTextEditors) {
		if (!(editor.document.languageId === "cangjie" || editor.document.fileName.endsWith(".cj"))) {
			continue
		}
		const content = editor.document.getText()
		const defs = parseCangjieDefinitions(content).filter(
			(d: CangjieDef) => d.kind !== "import" && d.kind !== "package",
		)
		if (defs.length === 0) continue
		fileSymbols.push({ fileName: path.basename(editor.document.fileName), defs })
		totalDefs += defs.length
	}

	if (fileSymbols.length === 0) return null

	const lines: string[] = ["## 当前编辑文件的符号定义\n"]

	let remaining = MAX_DEFS
	for (const { fileName, defs } of fileSymbols) {
		lines.push(`**${fileName}**:`)

		const topLevel = totalDefs > MAX_DEFS
			? defs.filter((d) => ["class", "struct", "interface", "enum", "extend", "main"].includes(d.kind))
			: defs

		for (const def of topLevel) {
			if (remaining <= 0) break
			const span = def.endLine > def.startLine ? ` (${def.startLine + 1}-${def.endLine + 1} 行)` : ""

			const children = defs.filter(
				(d) => d !== def && d.startLine > def.startLine && d.endLine <= def.endLine && d.kind === "func",
			)

			if (children.length > 0) {
				const childNames = children.slice(0, 5).map((c) => c.name).join(", ")
				const suffix = children.length > 5 ? ` 等 ${children.length} 个方法` : ""
				lines.push(`- ${def.kind} ${def.name}${span}: 包含 ${childNames}${suffix}`)
			} else {
				lines.push(`- ${def.kind} ${def.name}${span}`)
			}
			remaining--
		}

		if (remaining <= 0) {
			lines.push(`- …（已省略，共 ${totalDefs} 个定义）`)
			break
		}
	}

	return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Cross-file symbol resolution via CangjieSymbolIndex
// ---------------------------------------------------------------------------

const MAX_IMPORT_SYMBOLS = 60
const MAX_SYMBOLS_PER_PACKAGE = 15

/**
 * Resolve local (non-stdlib) import paths to workspace symbols using
 * CangjieSymbolIndex. For each import like `import mylib.utils.*`, find
 * the corresponding directory under src/ and return its public symbols.
 */
function resolveImportedSymbols(
	imports: string[],
	cwd: string,
	projectInfo: CjpmProjectInfo | null,
): string | null {
	const symbolIndex = CangjieSymbolIndex.getInstance()
	if (!symbolIndex || symbolIndex.symbolCount === 0) return null

	const localImports = imports.filter((imp) => !imp.startsWith("std."))
	if (localImports.length === 0) return null

	const rootName = projectInfo?.name || ""
	const srcDir = projectInfo?.srcDir || "src"

	const sections: string[] = []
	let totalSymbols = 0

	for (const imp of localImports) {
		if (totalSymbols >= MAX_IMPORT_SYMBOLS) break

		const dirPath = resolveImportToDirectory(imp, cwd, rootName, srcDir, projectInfo)
		if (!dirPath) continue

		const symbols = symbolIndex.getSymbolsByDirectory(dirPath)
		if (symbols.length === 0) continue

		const publicSymbols = symbols.slice(0, MAX_SYMBOLS_PER_PACKAGE)
		const lines = formatSymbolEntries(publicSymbols, cwd)
		if (lines.length === 0) continue

		sections.push(`**${imp}** (${path.relative(cwd, dirPath).replace(/\\/g, "/")}/):\n${lines.join("\n")}`)
		totalSymbols += publicSymbols.length
	}

	if (sections.length === 0) return null

	return `## 已导入的工作区模块符号\n\n以下是当前文件 import 的本地包中的符号定义，可直接在代码中引用：\n\n${sections.join("\n\n")}`
}

/**
 * Map an import path like "mylib.utils.http" to the corresponding directory
 * on disk. Tries several strategies:
 *  1. Strip root package name and map remaining segments to src/ subdirs
 *  2. For workspace projects, check if the first segment matches a member name
 */
function resolveImportToDirectory(
	importPath: string,
	cwd: string,
	rootName: string,
	srcDir: string,
	projectInfo: CjpmProjectInfo | null,
): string | null {
	const segments = importPath.split(".")

	if (projectInfo?.isWorkspace && projectInfo.members) {
		const memberMatch = projectInfo.members.find((m) => m.name === segments[0])
		if (memberMatch) {
			const memberCwd = path.join(cwd, memberMatch.path)
			const subPath = segments.slice(1).join(path.sep)
			const candidate = subPath
				? path.join(memberCwd, "src", subPath)
				: path.join(memberCwd, "src")
			if (fs.existsSync(candidate)) return candidate
		}
	}

	if (rootName && segments[0] === rootName) {
		const subPath = segments.slice(1).join(path.sep)
		const candidate = subPath
			? path.join(cwd, srcDir, subPath)
			: path.join(cwd, srcDir)
		if (fs.existsSync(candidate)) return candidate
	}

	const directPath = segments.join(path.sep)
	const candidate = path.join(cwd, srcDir, directPath)
	if (fs.existsSync(candidate)) return candidate

	return null
}

const TYPE_OUTLINE_MAX_LINES = 40
const TYPE_OUTLINE_MAX_CHARS = 1200
const MAX_TYPE_OUTLINES_PER_IMPORT_BLOCK = 4
const TYPE_MEMBER_DISPLAY_MAX = 8

function extractTypeOutlineFromLines(lines: string[], sym: SymbolEntry): string | null {
	if (!["class", "struct", "interface"].includes(sym.kind)) return null
	const from = sym.startLine
	const to = Math.min(sym.endLine, sym.startLine + TYPE_OUTLINE_MAX_LINES - 1)
	let slice = lines.slice(from, to + 1).join("\n")
	slice = slice.replace(/[ \t]+\n/g, "\n").trim()
	if (slice.length > TYPE_OUTLINE_MAX_CHARS) {
		return `${slice.slice(0, TYPE_OUTLINE_MAX_CHARS)}…`
	}
	return slice
}

function formatSymbolEntries(symbols: SymbolEntry[], cwd: string): string[] {
	const lines: string[] = []
	const grouped = new Map<string, SymbolEntry[]>()

	for (const sym of symbols) {
		const relFile = path.relative(cwd, sym.filePath).replace(/\\/g, "/")
		if (!grouped.has(relFile)) grouped.set(relFile, [])
		grouped.get(relFile)!.push(sym)
	}

	let outlineBudget = MAX_TYPE_OUTLINES_PER_IMPORT_BLOCK

	for (const [file, syms] of grouped) {
		for (const sym of syms) {
			const sig = sym.signature ? `: \`${sym.signature}\`` : ""
			lines.push(`- ${sym.kind} **${sym.name}**${sig} _(${file}:${sym.startLine + 1})_`)
			if (outlineBudget <= 0 || !["class", "struct", "interface"].includes(sym.kind)) {
				continue
			}
			try {
				const fileLines = fs.readFileSync(sym.filePath, "utf-8").split("\n")
				const { members, totalMatchingLines } = extractTypeMemberSummaries(
					fileLines,
					sym.startLine,
					sym.endLine,
					TYPE_MEMBER_DISPLAY_MAX + 4,
				)
				if (members.length > 0) {
					outlineBudget--
					const display = members.slice(0, TYPE_MEMBER_DISPLAY_MAX)
					const omitted =
						totalMatchingLines > display.length
							? `（共约 ${totalMatchingLines} 个成员样例行，以下 ${display.length} 条）`
							: ""
					const body = display.map((l) => `      ${l}`).join("\n")
					lines.push(`    - 成员概要${omitted}:\n${body}`)
				} else {
					const outline = extractTypeOutlineFromLines(fileLines, sym)
					if (outline) {
						outlineBudget--
						const indented = outline
							.split("\n")
							.map((l) => `      ${l}`)
							.join("\n")
						lines.push(`    - 类型头/成员草稿:\n${indented}`)
					}
				}
			} catch {
				/* skip */
			}
		}
	}

	return lines
}

// ---------------------------------------------------------------------------
// Source-level package declaration verification
// ---------------------------------------------------------------------------

/**
 * Read actual `package` declarations from .cj source files and compare
 * with directory-inferred package names. Report mismatches so the AI
 * can generate correct package declarations.
 */
function verifyPackageDeclarations(
	root: PackageNode,
	cwd: string,
	srcDir: string,
): string | null {
	const mismatches: string[] = []
	const MAX_CHECKS = 50
	let checked = 0

	function walk(node: PackageNode): void {
		if (checked >= MAX_CHECKS) return

		for (const fileName of node.sourceFiles) {
			if (checked >= MAX_CHECKS) return
			checked++

			const filePath = path.join(cwd, node.dirPath, fileName)
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const match = content.match(PACKAGE_DECL_REGEX)
				const declaredPkg = match ? match[1] : null
				const expectedPkg = node.packageName

				if (declaredPkg && declaredPkg !== expectedPkg) {
					const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
					mismatches.push(
						`- ${relPath}: 声明 \`package ${declaredPkg}\`，但目录推导应为 \`package ${expectedPkg}\``,
					)
				} else if (!declaredPkg && node.packageName.includes(".")) {
					const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
					mismatches.push(
						`- ${relPath}: **缺少 package 声明**，应声明 \`package ${expectedPkg}\``,
					)
				}
			} catch {
				// skip unreadable files
			}
		}

		for (const child of node.children) {
			walk(child)
		}
	}

	walk(root)

	if (mismatches.length === 0) return null

	return (
		`## ⚠ 包声明不一致\n\n` +
		`以下文件的 \`package\` 声明与目录结构不匹配，**生成代码时请使用正确的包名**：\n\n` +
		mismatches.join("\n") +
		`\n\n规则: 文件所在目录相对于 ${srcDir}/ 的路径决定包名（如 ${srcDir}/network/http/ → package <root>.network.http）`
	)
}

// ---------------------------------------------------------------------------
// Workspace cross-module symbol summary
// ---------------------------------------------------------------------------

/**
 * For workspace projects, generate a summary of public symbols in each
 * member module so the AI knows what's available across modules.
 */
function buildWorkspaceSymbolSummary(
	info: CjpmProjectInfo,
	cwd: string,
): string | null {
	if (!info.isWorkspace || !info.members || info.members.length === 0) return null

	const symbolIndex = CangjieSymbolIndex.getInstance()
	if (!symbolIndex || symbolIndex.symbolCount === 0) return null

	const MAX_SYMBOLS_PER_MODULE = 20
	const moduleSections: string[] = []

	for (const member of info.members) {
		const memberSrcDir = path.join(cwd, member.path, "src")
		if (!fs.existsSync(memberSrcDir)) continue

		const symbols = symbolIndex.getSymbolsByDirectory(memberSrcDir)
		if (symbols.length === 0) continue

		const topLevel = symbols
			.filter((s) => ["class", "struct", "interface", "enum", "func", "type"].includes(s.kind))
			.slice(0, MAX_SYMBOLS_PER_MODULE)

		if (topLevel.length === 0) continue

		const lines = topLevel.map((s) => {
			const sig = s.signature ? `: \`${s.signature}\`` : ""
			return `  - ${s.kind} **${s.name}**${sig}`
		})

		const suffix = symbols.length > MAX_SYMBOLS_PER_MODULE
			? `\n  - _…共 ${symbols.length} 个符号_`
			: ""

		moduleSections.push(`- **${member.name}** (${member.outputType}):\n${lines.join("\n")}${suffix}`)
	}

	if (moduleSections.length === 0) return null

	return (
		`## 工作区各模块公共符号\n\n` +
		`以下是各模块的主要类型和函数定义，跨模块引用时需确保目标符号为 public 并在 cjpm.toml 中声明依赖：\n\n` +
		moduleSections.join("\n\n")
	)
}

/**
 * Collect current cjlint/cjc diagnostics from VS Code.
 */
function collectCangjieDiagnostics(): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = []

	for (const [uri, diags] of vscode.languages.getDiagnostics()) {
		if (uri.fsPath.endsWith(".cj")) {
			diagnostics.push(...diags)
		}
	}

	return diagnostics
}

/**
 * Map diagnostic messages to error patterns and documentation.
 */
function mapDiagnosticsToDocContext(diagnostics: vscode.Diagnostic[], docsBase: string): string[] {
	const matchedCategories = new Set<string>()
	const sections: string[] = []

	for (const diag of diagnostics) {
		const pattern = resolveCjcPatternForDiagnostic(diag)
		if (pattern && !matchedCategories.has(pattern.category)) {
			matchedCategories.add(pattern.category)
			const docPathsStr = pattern.docPaths
				.map((p) => path.join(docsBase, p).replace(/\\/g, "/"))
				.join(", ")
			const codeStr = normalizeDiagnosticCode(diag)
			const codeNote = codeStr ? ` (code: ${codeStr})` : ""
			sections.push(
				`- **${pattern.category}**${codeNote}: ${pattern.suggestion}\n  参考文档: ${docPathsStr}`,
			)
		}
	}

	return sections
}

export function resolveBundledCangjieCorpusPath(extensionPath: string | undefined): string | null {
	return getBundledCangjieCorpusPath(extensionPath)
}

/**
 * Resolve the Cangjie documentation / corpus root.
 * **Only** the extension-bundled tree (`bundled-cangjie-corpus/CangjieCorpus-1.0.0`). No workspace or `.njust_ai` fallbacks.
 */
export function resolveCangjieDocsBasePath(extensionPath?: string): string | null {
	return resolveBundledCangjieCorpusPath(extensionPath)
}

const STYLE_FEW_SHOT_MAX_CHARS = 2200
const STYLE_SNIPPET_LINES = 16

function buildCangjieStyleFewShotSection(cwd: string): string | null {
	const idx = CangjieSymbolIndex.getInstance()
	if (!idx || idx.symbolCount === 0) return null

	const header =
		"## 工作区代码风格样本（few-shot）\n\n从符号索引中选取的代表性片段，新建代码时请保持相近风格与命名习惯：\n\n"
	let used = header.length
	const picked: string[] = []
	const kinds = new Set(["func", "class", "struct"])

	const scored: Array<{ score: number; rel: string; block: string }> = []
	for (const sym of idx.getAllSymbols()) {
		if (!kinds.has(sym.kind)) continue
		const sigLen = sym.signature.length
		const span = sym.endLine - sym.startLine + 1
		const score = sigLen + span * 8
		try {
			const content = fs.readFileSync(sym.filePath, "utf-8")
			const lines = content.split("\n")
			const from = sym.startLine
			const to = Math.min(sym.endLine, sym.startLine + STYLE_SNIPPET_LINES - 1)
			const slice = lines.slice(from, to + 1).join("\n")
			if (slice.trim().length < 24) continue
			const rel = path.relative(cwd, sym.filePath).replace(/\\/g, "/")
			const block =
				"```cangjie\n" +
				`// ${sym.kind} ${sym.name} (${rel}:${from + 1})\n` +
				slice +
				"\n```"
			scored.push({ score, rel, block })
		} catch {
			/* skip */
		}
	}

	scored.sort((a, b) => b.score - a.score)
	const seenRel = new Set<string>()
	for (const s of scored) {
		if (picked.length >= 3) break
		if (seenRel.has(s.rel)) continue
		seenRel.add(s.rel)
		if (used + s.block.length + 2 > STYLE_FEW_SHOT_MAX_CHARS) break
		picked.push(s.block)
		used += s.block.length + 2
	}

	if (picked.length === 0) return null
	return `${header}${picked.join("\n\n")}`
}

// ---------------------------------------------------------------------------
// cjpm.toml parsing
// ---------------------------------------------------------------------------

function splitTomlSections(content: string): Map<string, string> {
	const sections = new Map<string, string>()
	const lines = content.split("\n")
	let currentSection = ""
	let currentLines: string[] = []

	for (const line of lines) {
		const match = line.match(/^\s*\[([^\]]+)\]\s*$/)
		if (match) {
			if (currentSection) {
				sections.set(currentSection, currentLines.join("\n"))
			}
			currentSection = match[1].trim()
			currentLines = []
		} else {
			currentLines.push(line)
		}
	}

	if (currentSection) {
		sections.set(currentSection, currentLines.join("\n"))
	}

	return sections
}

function extractTomlString(section: string, key: string): string | undefined {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"`, "m")
	const match = section.match(re)
	return match ? match[1] : undefined
}

function extractTomlArray(section: string, key: string): string[] {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp(`^\\s*${escaped}\\s*=\\s*\\[([^\\]]*)\\]`, "ms")
	const match = section.match(re)
	if (!match) return []
	return match[1].match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) || []
}

function extractTomlInlineTables(section: string): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {}
	const re = /^\s*(\S+)\s*=\s*\{([^}]*)\}\s*$/gm
	let match
	while ((match = re.exec(section)) !== null) {
		const key = match[1].trim()
		const tableContent = match[2]
		const table: Record<string, string> = {}
		const kvRe = /([\w][\w-]*)\s*=\s*"([^"]*)"/g
		let kvMatch
		while ((kvMatch = kvRe.exec(tableContent)) !== null) {
			table[kvMatch[1]] = kvMatch[2]
		}
		result[key] = table
	}
	return result
}

function parseSingleModuleProject(sections: Map<string, string>): CjpmProjectInfo | null {
	const pkg = sections.get("package")
	if (!pkg) return null

	const name = extractTomlString(pkg, "name") || ""
	const version = extractTomlString(pkg, "version") || ""
	const outputType = extractTomlString(pkg, "output-type") || "executable"
	const srcDir = extractTomlString(pkg, "src-dir") || "src"

	let dependencies: CjpmProjectInfo["dependencies"]
	const deps = sections.get("dependencies")
	if (deps) {
		const tables = extractTomlInlineTables(deps)
		if (Object.keys(tables).length > 0) {
			dependencies = {}
			for (const [depName, t] of Object.entries(tables)) {
				dependencies[depName] = { path: t["path"], git: t["git"], tag: t["tag"], branch: t["branch"] }
			}
		}
	}

	return { name, version, outputType, isWorkspace: false, srcDir, dependencies }
}

function parseWorkspaceProject(sections: Map<string, string>, cwd: string): CjpmProjectInfo | null {
	const ws = sections.get("workspace")
	if (!ws) return null

	const memberPaths = extractTomlArray(ws, "members")
	const members: CjpmProjectInfo["members"] = []

	for (const mp of memberPaths.slice(0, MAX_WORKSPACE_MEMBERS)) {
		const memberToml = path.join(cwd, mp, "cjpm.toml")
		if (!fs.existsSync(memberToml)) continue
		try {
			const content = fs.readFileSync(memberToml, "utf-8")
			const ms = splitTomlSections(content)
			const pkg = ms.get("package")
			if (pkg) {
				members.push({
					name: extractTomlString(pkg, "name") || path.basename(mp),
					path: mp,
					outputType: extractTomlString(pkg, "output-type") || "static",
				})
			}
		} catch {
			/* skip unreadable member */
		}
	}

	let dependencies: CjpmProjectInfo["dependencies"]
	const deps = sections.get("dependencies")
	if (deps) {
		const tables = extractTomlInlineTables(deps)
		if (Object.keys(tables).length > 0) {
			dependencies = {}
			for (const [depName, t] of Object.entries(tables)) {
				dependencies[depName] = { path: t["path"], git: t["git"] }
			}
		}
	}

	return { name: "", version: "", outputType: "", isWorkspace: true, members, dependencies, srcDir: "src" }
}

function parseCjpmToml(cwd: string): CjpmProjectInfo | null {
	const tomlPath = path.join(cwd, "cjpm.toml")
	if (!fs.existsSync(tomlPath)) return null

	try {
		const content = fs.readFileSync(tomlPath, "utf-8")
		const sections = splitTomlSections(content)
		if (sections.has("workspace")) {
			return parseWorkspaceProject(sections, cwd)
		}
		if (sections.has("package")) {
			return parseSingleModuleProject(sections)
		}
	} catch {
		/* ignore parse errors */
	}

	return null
}

// ---------------------------------------------------------------------------
// Package hierarchy scanning
// ---------------------------------------------------------------------------

function scanPackageHierarchy(cwd: string, srcDir: string, rootPackageName?: string): PackageNode | null {
	const srcPath = path.join(cwd, srcDir)
	if (!fs.existsSync(srcPath)) return null

	let fileCount = 0
	const rootPkg = rootPackageName || "default"

	function scan(dir: string, depth: number, pkgName: string): PackageNode | null {
		if (depth > MAX_SCAN_DEPTH || fileCount > MAX_SCAN_FILES) return null

		let entries: fs.Dirent[]
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return null
		}

		const sourceFiles: string[] = []
		const testFiles: string[] = []
		let hasMain = false
		const childDirs: fs.Dirent[] = []

		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".cj")) {
				fileCount++
				if (entry.name.endsWith("_test.cj")) {
					testFiles.push(entry.name)
				} else {
					sourceFiles.push(entry.name)
					if (entry.name === "main.cj") hasMain = true
				}
			} else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "target") {
				childDirs.push(entry)
			}
		}

		const children: PackageNode[] = []
		for (const cd of childDirs) {
			const childNode = scan(path.join(dir, cd.name), depth + 1, `${pkgName}.${cd.name}`)
			if (childNode) children.push(childNode)
		}

		if (sourceFiles.length === 0 && testFiles.length === 0 && children.length === 0) return null

		return {
			packageName: pkgName,
			dirPath: path.relative(cwd, dir).replace(/\\/g, "/"),
			sourceFiles,
			testFiles,
			hasMain,
			children,
		}
	}

	return scan(srcPath, 0, rootPkg)
}

function countTreeFiles(node: PackageNode, testOnly: boolean): number {
	const count = testOnly ? node.testFiles.length : node.sourceFiles.length
	return count + node.children.reduce((sum, child) => sum + countTreeFiles(child, testOnly), 0)
}

// ---------------------------------------------------------------------------
// System prompt section formatters
// ---------------------------------------------------------------------------

function formatProjectInfoSection(info: CjpmProjectInfo): string {
	const lines: string[] = ["## 当前仓颉项目信息\n"]

	if (info.isWorkspace) {
		lines.push("项目类型: workspace（多模块工作区）")
		if (info.members && info.members.length > 0) {
			lines.push("\n工作区成员:")
			for (const m of info.members) {
				lines.push(`- ${m.name} (${m.outputType}) — ${m.path}`)
			}
		}
	} else {
		lines.push(`项目名: ${info.name} | 版本: ${info.version} | 类型: ${info.outputType}`)
	}

	if (info.dependencies && Object.keys(info.dependencies).length > 0) {
		lines.push("\n依赖:")
		for (const [name, dep] of Object.entries(info.dependencies)) {
			if (dep.path) {
				lines.push(`- ${name} (本地: ${dep.path})`)
			} else if (dep.git) {
				const ver = dep.tag || dep.branch || ""
				lines.push(`- ${name} (git: ${dep.git}${ver ? `, ${ver}` : ""})`)
			}
		}
	}

	return lines.join("\n")
}

function formatPackageTreeSection(root: PackageNode, info: CjpmProjectInfo): string {
	const lines: string[] = ["## 当前包结构\n"]

	function renderNode(node: PackageNode, indent: string, isLast: boolean): void {
		const connector = isLast ? "└── " : "├── "
		const files = [...node.sourceFiles, ...node.testFiles.map((f) => `${f} (测试)`)].join(", ")
		const mainTag = node.hasMain ? " ← 入口" : ""
		lines.push(`${indent}${connector}[${node.packageName}] ${files}${mainTag}`)

		const childIndent = indent + (isLast ? "    " : "│   ")
		node.children.forEach((child, i) => {
			renderNode(child, childIndent, i === node.children.length - 1)
		})
	}

	const rootFiles = [...root.sourceFiles, ...root.testFiles.map((f) => `${f} (测试)`)].join(", ")
	lines.push(`${root.dirPath}/`)
	if (rootFiles) {
		lines.push(`├── [${root.packageName}] ${rootFiles}${root.hasMain ? " ← 入口" : ""}`)
	}
	root.children.forEach((child, i) => {
		renderNode(child, "", i === root.children.length - 1)
	})

	lines.push(
		`\n包声明规则: 子包声明须与相对于 ${info.srcDir}/ 的目录路径匹配（如 ${info.srcDir}/network/http/ → package ${root.packageName}.network.http）`,
	)

	return lines.join("\n")
}

function formatWorkspaceModulesSection(info: CjpmProjectInfo, cwd: string): string | null {
	if (!info.members || info.members.length === 0) return null

	const lines: string[] = ["## 工作区模块结构\n"]

	for (const member of info.members) {
		const memberCwd = path.join(cwd, member.path)
		const pkgTree = scanPackageHierarchy(memberCwd, "src", member.name)
		if (pkgTree) {
			const srcCount = countTreeFiles(pkgTree, false)
			const testCount = countTreeFiles(pkgTree, true)
			lines.push(
				`- ${member.name} (${member.outputType}): ${srcCount} 源文件, ${testCount} 测试文件${pkgTree.hasMain ? ", 含 main" : ""}`,
			)
		} else {
			lines.push(`- ${member.name} (${member.outputType}): 未发现源文件`)
		}
	}

	lines.push("\n各模块包声明规则: 子包声明须与相对于 src/ 的目录路径匹配")

	return lines.join("\n")
}

function buildDependencyContext(info: CjpmProjectInfo, cwd: string): string | null {
	if (!info.isWorkspace || !info.members || info.members.length === 0) return null

	const lines: string[] = ["## 模块间依赖关系\n"]
	let hasDeps = false

	for (const member of info.members) {
		const memberToml = path.join(cwd, member.path, "cjpm.toml")
		if (!fs.existsSync(memberToml)) continue

		try {
			const content = fs.readFileSync(memberToml, "utf-8")
			const memberSections = splitTomlSections(content)
			const deps = memberSections.get("dependencies")
			if (!deps) continue

			const tables = extractTomlInlineTables(deps)
			const depNames = Object.keys(tables)
			if (depNames.length === 0) continue

			hasDeps = true
			const depList = depNames
				.map((d) => {
					const t = tables[d]
					if (t["path"]) return `${d} (本地: ${t["path"]})`
					if (t["git"]) return `${d} (git)`
					return d
				})
				.join(", ")
			lines.push(`- ${member.name} → ${depList}`)
		} catch {
			/* skip */
		}
	}

	if (!hasDeps) return null

	lines.push(
		"\n注意: 修改模块间的依赖关系时，须同步更新对应 cjpm.toml 中的 [dependencies]。使用 `cjpm check` 验证依赖无循环。",
	)

	return lines.join("\n")
}

/**
 * Load project-specific error→fix hints from .njust_ai/learned-fixes.json (manual curation).
 */
function loadLearnedFixesSection(cwd: string): string | null {
	const fp = path.join(cwd, NJUST_AI_CONFIG_DIR, LEARNED_FIXES_FILE)
	if (!fs.existsSync(fp)) return null

	try {
		const raw = fs.readFileSync(fp, "utf-8")
		const data = JSON.parse(raw) as { patterns?: unknown }
		if (!data || !Array.isArray(data.patterns)) return null

		const header = `## 本项目常见修复提示（${NJUST_AI_CONFIG_DIR}/${LEARNED_FIXES_FILE}）\n\n`
		const lines: string[] = []
		let used = header.length

		for (const entry of data.patterns) {
			if (!entry || typeof entry !== "object") continue
			const p = entry as LearnedFixPattern
			if (typeof p.errorPattern !== "string" || typeof p.fix !== "string") continue

			const epDisplay = p.errorPattern.replace(/`/g, "'").slice(0, 200)
			const fixDisplay = p.fix.replace(/`/g, "'").slice(0, 500)
			const occ =
				typeof p.occurrences === "number" && p.occurrences > 0 ? `（约 ${p.occurrences} 次）` : ""
			const line = `- 匹配 \`${epDisplay}\`：${fixDisplay}${occ}`
			if (used + line.length + 1 > LEARNED_FIXES_MAX_SECTION_CHARS) {
				lines.push(
					`\n…（其余条目已省略以保持上下文长度；可打开 ${NJUST_AI_CONFIG_DIR}/${LEARNED_FIXES_FILE} 查看全部）`,
				)
				break
			}
			lines.push(line)
			used += line.length + 1
		}

		if (lines.length === 0) return null
		return `${header}${lines.join("\n")}`
	} catch {
		return null
	}
}

const LEARNED_FIXES_MAX_PATTERNS = 80

/**
 * Auto-record a resolved error→fix pattern to the learned-fixes JSON.
 * Called by the compile-fix loop when an error is successfully resolved.
 * Deduplicates by errorPattern (bumps occurrences), caps at LEARNED_FIXES_MAX_PATTERNS.
 */
export function recordLearnedFix(
	cwd: string,
	errorPattern: string,
	fix: string,
	projectSpecific = true,
): void {
	const dir = path.join(cwd, NJUST_AI_CONFIG_DIR)
	const fp = path.join(dir, LEARNED_FIXES_FILE)

	let data: { patterns: LearnedFixPattern[] } = { patterns: [] }

	try {
		if (fs.existsSync(fp)) {
			const raw = fs.readFileSync(fp, "utf-8")
			const parsed = JSON.parse(raw)
			if (parsed && Array.isArray(parsed.patterns)) {
				data = parsed
			}
		}
	} catch {
		// Start fresh if parse fails
	}

	// Normalize for dedup
	const normalizedPattern = errorPattern.trim().toLowerCase().slice(0, 300)

	// Check for existing match (dedup by error pattern similarity)
	const existing = data.patterns.find((p) => {
		const existingNorm = p.errorPattern.trim().toLowerCase().slice(0, 300)
		return existingNorm === normalizedPattern || existingNorm.includes(normalizedPattern) || normalizedPattern.includes(existingNorm)
	})

	if (existing) {
		existing.occurrences = (existing.occurrences || 1) + 1
		// Update fix if the new one is more detailed
		if (fix.length > existing.fix.length) {
			existing.fix = fix.slice(0, 1000)
		}
	} else {
		if (data.patterns.length >= LEARNED_FIXES_MAX_PATTERNS) {
			// Evict least-seen entry
			data.patterns.sort((a, b) => (a.occurrences || 0) - (b.occurrences || 0))
			data.patterns.shift()
		}
		data.patterns.push({
			errorPattern: errorPattern.slice(0, 500),
			fix: fix.slice(0, 1000),
			projectSpecific,
			occurrences: 1,
		})
	}

	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8")
	} catch {
		// Non-critical: ignore write failures
	}
}

// ---------------------------------------------------------------------------
// cjpm tree integration (Phase 2.3) — precise dependency tree
// ---------------------------------------------------------------------------

/**
 * Run `cjpm tree` via CangjieCompileGuard and return formatted context section.
 * Uses lazy require to avoid circular dependency.
 * Returns null if cjpm is unavailable or no tree output.
 */
async function getCjpmTreeSection(cwd: string): Promise<string | null> {
	try {
		// Lazy import — CangjieCompileGuard is initialized after context builder
		const { CangjieCompileGuard } = require("../../../services/cangjie-lsp/CangjieCompileGuard") as typeof import("../../../services/cangjie-lsp/CangjieCompileGuard")
		// Use a lightweight singleton guard just for tree queries
		const guard = new CangjieCompileGuard({ appendLine: () => {} } as unknown as import("vscode").OutputChannel)
		const summary = await guard.getCjpmTreeSummary(cwd)
		guard.dispose()
		return summary || null
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Dynamic coding rules injection (context-aware)
// ---------------------------------------------------------------------------

const CODING_RULES_MAX_CHARS = 3000

/**
 * Selectively inject coding rules based on the current editing context.
 * Instead of blindly inlining the full CANGJIE_CODING_RULES (~870 lines)
 * into every prompt, we inject only the relevant sections based on:
 *   - What files are currently open (test file → test templates)
 *   - What imports are present (std.sync → concurrency rules)
 *   - Whether there are compilation errors (→ error table)
 *   - Whether it's a workspace project (→ workspace workflow)
 */
function buildContextualCodingRules(
	imports: string[],
	projectInfo: CjpmProjectInfo | null,
): string | null {
	const parts: string[] = []
	let budget = CODING_RULES_MAX_CHARS

	const hasActiveCangjieFile = vscode.window.visibleTextEditors.some(
		(e) => e.document.languageId === "cangjie" || e.document.fileName.endsWith(".cj"),
	)

	if (!hasActiveCangjieFile && !projectInfo) return null

	// Detect what's relevant for context-aware injection
	const hasTestFile = vscode.window.visibleTextEditors.some(
		(e) => e.document.fileName.endsWith("_test.cj"),
	)
	const hasMainFile = vscode.window.visibleTextEditors.some(
		(e) => e.document.fileName.endsWith("main.cj"),
	)
	const hasSyncImport = imports.some((i) => i.startsWith("std.sync"))
	const hasErrors = collectCangjieDiagnostics().some(
		(d) => d.severity === vscode.DiagnosticSeverity.Error,
	)
	const isWorkspace = projectInfo?.isWorkspace ?? false

	// Always inject the core project templates (compact)
	const coreTemplates =
		"## 仓颉代码模板\n\n" +
		"### 可执行项目入口\n```cangjie\npackage my_app\nimport std.console.*\nmain(): Int64 {\n    println(\"Hello, Cangjie!\")\n    return 0\n}\n```\n"

	if (budget >= coreTemplates.length) {
		parts.push(coreTemplates)
		budget -= coreTemplates.length
	}

	// Test templates when editing test files
	if (hasTestFile) {
		const testTemplate =
			"### 测试文件模板\n```cangjie\npackage my_app\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test\nclass MyTest {\n    @TestCase\n    func testBasic() {\n        @Assert(1 + 1 == 2)\n    }\n}\n```\n"
		if (budget >= testTemplate.length) {
			parts.push(testTemplate)
			budget -= testTemplate.length
		}
	}

	// Error handling patterns when there are active errors
	if (hasErrors) {
		const errorTable =
			"### 常见编译错误速查\n" +
			"| 错误类型 | 解决方案 |\n" +
			"|----------|----------|\n" +
			"| 未找到符号 | 检查 import 语句和 cjpm.toml 依赖 |\n" +
			"| 类型不匹配 | 检查类型声明和转换 |\n" +
			"| let 变量赋值 | 改用 `var` 声明 |\n" +
			"| mut 函数限制 | let 变量调用 mut 函数 → 改用 `var` |\n" +
			"| 递归结构体 | struct 不能自引用 → 改用 class 或 Option |\n" +
			"| match 不穷尽 | 补全 case 或添加 `case _ =>` |\n" +
			"| 参数数量错误 | 检查命名参数需用 `name:` 语法 |\n"
		if (budget >= errorTable.length) {
			parts.push(errorTable)
			budget -= errorTable.length
		}
	}

	// Anti-patterns for let/var/mut when editing struct code
	if (hasActiveCangjieFile) {
		const antiPatterns =
			"### 常见反例\n" +
			"- ❌ `let c = Counter(); c.inc()` — let 绑定的 struct 不能调用 mut 方法 → ✅ `var c = Counter()`\n" +
			"- ❌ `struct Node { let next: Node }` — struct 不能自引用 → ✅ `class Node { let next: ?Node = None }`\n" +
			"- ❌ Option 直接 unwrap → ✅ 用 `??` 默认值或 match/if-let 安全解包\n"
		if (budget >= antiPatterns.length) {
			parts.push(antiPatterns)
			budget -= antiPatterns.length
		}
	}

	// Concurrency rules when using std.sync
	if (hasSyncImport) {
		const concurrencyRules =
			"### 并发注意事项\n" +
			"- spawn 块内不能直接捕获 `var` 变量\n" +
			"- 共享可变状态必须使用 Mutex/AtomicInt 保护\n" +
			"- 使用 `synchronized` 块或 `mutex.lock()/unlock()` 确保互斥\n"
		if (budget >= concurrencyRules.length) {
			parts.push(concurrencyRules)
			budget -= concurrencyRules.length
		}
	}

	// Workspace workflow when it's a multi-module project
	if (isWorkspace) {
		const wsWorkflow =
			"### Workspace 项目规则\n" +
			"- `[workspace]` 和 `[package]` 不能在同一 cjpm.toml\n" +
			"- 模块间依赖: `{ path = \"../module_name\" }` 写在子模块的 `[dependencies]`\n" +
			"- `cjpm run --name <模块>` 运行指定模块\n" +
			"- 每个模块需独立的 cjpm.toml 和 src/ 目录\n"
		if (budget >= wsWorkflow.length) {
			parts.push(wsWorkflow)
			budget -= wsWorkflow.length
		}
	}

	if (parts.length === 0) return null
	return parts.join("\n")
}

/**
 * Generate the Cangjie context section for the system prompt.
 * Only included when mode is "cangjie".
 */
export async function getCangjieContextSection(
	cwd: string,
	mode: string,
	extensionPath?: string,
): Promise<string> {
	if (mode !== "cangjie") return ""

	const docsBase = resolveCangjieDocsBasePath(extensionPath)
	const docsExist = docsBase != null && fs.existsSync(docsBase)

	const sections: string[] = []

	// 0a. Project structure context (cjpm.toml)
	const projectInfo = parseCjpmToml(cwd)
	if (projectInfo) {
		sections.push(formatProjectInfoSection(projectInfo))
	}

	// 0b. Package hierarchy context + package declaration verification
	if (projectInfo && !projectInfo.isWorkspace) {
		const rootPkgName = projectInfo.name || undefined
		const pkgTree = scanPackageHierarchy(cwd, projectInfo.srcDir, rootPkgName)
		if (pkgTree) {
			sections.push(formatPackageTreeSection(pkgTree, projectInfo))

			const pkgMismatches = verifyPackageDeclarations(pkgTree, cwd, projectInfo.srcDir)
			if (pkgMismatches) sections.push(pkgMismatches)
		}
	} else if (projectInfo && projectInfo.isWorkspace) {
		const modulesSection = formatWorkspaceModulesSection(projectInfo, cwd)
		if (modulesSection) sections.push(modulesSection)

		// Verify package declarations for each workspace member
		for (const member of projectInfo.members || []) {
			const memberCwd = path.join(cwd, member.path)
			const memberTree = scanPackageHierarchy(memberCwd, "src", member.name)
			if (memberTree) {
				const pkgMismatches = verifyPackageDeclarations(memberTree, memberCwd, "src")
				if (pkgMismatches) sections.push(pkgMismatches)
			}
		}
	}

	// 0c. Dependency context (workspace only)
	if (projectInfo) {
		const depCtx = buildDependencyContext(projectInfo, cwd)
		if (depCtx) sections.push(depCtx)

		// 0c2. cjpm tree — precise dependency tree via build tool (Phase 2.3)
		const treeSection = await getCjpmTreeSection(cwd)
		if (treeSection) sections.push(treeSection)
	}

	// Collect imports from visible editors (needed for multiple downstream sections)
	const imports = collectActiveCangjieImports()

	// Symbol scanning, import analysis, and doc mapping are only performed
	// when a cjpm.toml project exists, to keep context lightweight otherwise.
	if (projectInfo) {
		// 0d. Active file symbol definitions
		const symbolSection = collectActiveCangjieSymbols()
		if (symbolSection) {
			sections.push(symbolSection)
		}


		const importedSymbolsSection = resolveImportedSymbols(imports, cwd, projectInfo)
		if (importedSymbolsSection) {
			sections.push(importedSymbolsSection)
		}

		// 0f. Workspace cross-module symbol summary
		if (projectInfo.isWorkspace) {
			const wsSymbols = buildWorkspaceSymbolSummary(projectInfo, cwd)
			if (wsSymbols) sections.push(wsSymbols)
		}

		const styleFew = buildCangjieStyleFewShotSection(cwd)
		if (styleFew) {
			sections.push(styleFew)
		}

		// 1. Import-based documentation context
		if (imports.length > 0 && docsBase && docsExist) {
			const docMappings = mapImportsToDocPaths(imports)
			if (docMappings.length > 0) {
				const importContext = docMappings
					.map((m) => {
						const paths = m.docPaths.join(", ")
						return `- \`${m.prefix}\`: ${m.summary} (请视需检索: ${paths})`
					})
					.join("\n")

				const corpusRoot = docsBase.replace(/\\/g, "/")
				sections.push(
					`## 当前代码涉及的重要模块映射\n\n语料库根目录（read_file / search_files 使用绝对路径时以此为前缀）: \`${corpusRoot}\`\n\n当前代码中已引入以下高级模块。若后续编写代码缺乏十足把握，强烈建议立刻使用 \`search_files\`（regex 搜索）检索这些官方库的示例以避免幻觉：\n\n${importContext}`,
				)
			}
		}
	}

	// 1b. Dynamic coding rules injection (context-aware)
	const codingRulesSection = buildContextualCodingRules(imports, projectInfo)
	if (codingRulesSection) {
		sections.push(codingRulesSection)
	}

	// 2. Error/diagnostic context
	const diagnostics = collectCangjieDiagnostics()
	if (diagnostics.length > 0 && docsBase) {
		const errorSections = mapDiagnosticsToDocContext(diagnostics, docsBase)
		if (errorSections.length > 0) {
			sections.push(
				`## 当前诊断错误与修复建议\n\n检测到以下编译/检查错误，建议参考对应文档修复：\n\n${errorSections.join("\n")}`,
			)
		}
	}

	// 3. Agentic Retrieval Directive (Mandatory)
	if (docsBase && docsExist) {
		const corpusRootPosix = docsBase.replace(/\\/g, "/")
		sections.push(
			`## 仓颉主动式文档检索法则 (Agentic Retrieval - 强制！)\n\n` +
			`仓颉语料库根目录**绝对路径**：\`${corpusRootPosix}\`（**仅**随扩展安装的内置副本；常在当前工作区之外）。\n` +
			`**路径约定**：使用 \`read_file\` / \`search_files\`（即 grep 式检索工具）时，\`path\` 必须为该绝对路径，或其下的子目录/文件绝对路径；不要假设语料位于工作区相对路径下。\n` +
			`作为辅助程序，你必须视该目录为权威参考并遵守：\n` +
			`1. **动笔前预搜索**：在调用标准库(std)、鸿蒙库(ohos)中任何你未曾高频使用的方法前，必须调用 \`search_files\`，\`path\` 设为上述根目录（或 \`manual/source_zh_cn\`、\`libs\` 等子目录的绝对路径），搜索真实 API 签名以及代码段。\n` +
			`2. **深潜式阅读**：不要只看检索到的一行标题，发现可能的匹配文件后，使用 \`read_file\`（view_file）以绝对路径精确读完相关示例代码块，再动手写代码。\n` +
			`3. **报错自恰修复**：当遭遇 CangjieCompileGuard 或编译报错时，必须针对错误类型使用 \`search_files\` 在 \`${corpusRootPosix}/manual/source_zh_cn/\` 或 \`${corpusRootPosix}/libs/\` 下搜寻官方指引，再修代码。\n\n` +
			`**效率原则**：为减少迭代返工，在生成实现代码前必须完成上述检索+阅读流程，禁止凭记忆编写不确定的 API 调用。\n\n` +
			`核心速查:\n` +
			`- 语法指南: \`${corpusRootPosix}/manual/source_zh_cn/\`\n` +
			`- 标准类库: \`${corpusRootPosix}/libs/std/\``
		)
	}

	// 4. Structured editing context (cursor position, enclosing symbol, nearby code, LSP hover)
	const editingCtx = await buildStructuredEditingContext()
	if (editingCtx) {
		sections.push(editingCtx)
	}

	// 5. Project-curated learned fixes (optional JSON in .njust_ai/)
	const learnedFixes = loadLearnedFixesSection(cwd)
	if (learnedFixes) {
		sections.push(learnedFixes)
	}

	if (sections.length === 0) return ""

	return `====

CANGJIE DEVELOPMENT CONTEXT

${sections.join("\n\n")}
`
}

/**
 * Extract file:line:col references from cjc error output and read surrounding
 * source lines to provide richer context for AI-assisted fixes.
 */
const ERROR_CONTEXT_RADIUS = 8
const ERROR_CONTEXT_MAX_LOCATIONS = 8

function extractErrorSourceContext(errorOutput: string, cwd: string): string[] {
	const locationRe = /==>\s+(.+?):(\d+):(\d+):/g
	const contextLines: string[] = []
	const seen = new Set<string>()
	let match: RegExpExecArray | null
	const symbolIndex = CangjieSymbolIndex.getInstance()

	while ((match = locationRe.exec(errorOutput)) !== null) {
		const [, filePart, lineStr] = match
		const lineNum = parseInt(lineStr, 10) - 1
		const filePath = path.isAbsolute(filePart) ? filePart : path.resolve(cwd, filePart)
		const key = `${filePath}:${lineNum}`
		if (seen.has(key)) continue
		seen.add(key)

		try {
			if (!fs.existsSync(filePath)) continue
			const content = fs.readFileSync(filePath, "utf-8")
			const lines = content.split("\n")
			const start = Math.max(0, lineNum - ERROR_CONTEXT_RADIUS)
			const end = Math.min(lines.length, lineNum + ERROR_CONTEXT_RADIUS + 1)

			const snippet = lines
				.slice(start, end)
				.map((l, i) => {
					const num = start + i + 1
					const marker = num === lineNum + 1 ? " >>>" : "    "
					return `${marker} ${num}: ${l}`
				})
				.join("\n")

			const relPath = path.relative(cwd, filePath).replace(/\\/g, "/")
			let block = `文件: ${relPath} (第 ${lineNum + 1} 行)\n${snippet}`

			if (symbolIndex && filePath.endsWith(".cj")) {
				const enclosing = symbolIndex.findEnclosingSymbol(filePath, lineNum)
				if (enclosing?.signature) {
					block += `\n  所在符号: ${enclosing.kind} ${enclosing.name}\n  签名: ${enclosing.signature}`
				}
			}

			contextLines.push(block)
		} catch {
			// Skip unreadable files
		}

		if (contextLines.length >= ERROR_CONTEXT_MAX_LOCATIONS) break
	}

	if (contextLines.length >= ERROR_CONTEXT_MAX_LOCATIONS) {
		contextLines.push("（已达单段上下文展示上限；其余错误位置请查看完整编译输出。）")
	}

	return contextLines
}

/**
 * Enhance a cjc/cjlint error message with documentation references and fix suggestions.
 * Called when terminal output contains compilation errors.
 */
export function enhanceCjcErrorOutput(errorOutput: string, cwd: string, extensionPath?: string): string {
	const docsBase = resolveCangjieDocsBasePath(extensionPath)
	const docsExist = docsBase != null && fs.existsSync(docsBase)

	const matchedSuggestions: string[] = []
	const seen = new Set<string>()

	for (const pattern of CJC_ERROR_PATTERNS) {
		if (pattern.pattern.test(errorOutput) && !seen.has(pattern.category)) {
			seen.add(pattern.category)
			const docPaths =
				docsBase && docsExist ? pattern.docPaths.map((p) => path.join(docsBase, p).replace(/\\/g, "/")).join(", ") : ""
			const ref = docPaths ? ` (参考: ${docPaths})` : ""
			const directive = getErrorFixDirective(errorOutput)
			matchedSuggestions.push(`[${pattern.category}] ${pattern.suggestion}${ref}\n  AI 修复指令: ${directive}`)
		}
	}

	const sourceContexts = extractErrorSourceContext(errorOutput, cwd)

	if (matchedSuggestions.length === 0 && sourceContexts.length === 0) return ""

	const parts: string[] = []
	if (sourceContexts.length > 0) {
		parts.push(`出错位置源码:\n${sourceContexts.join("\n\n")}`)
	}
	if (matchedSuggestions.length > 0) {
		parts.push(matchedSuggestions.join("\n"))
	}

	return `\n\n<cangjie_error_hints>\n${parts.join("\n\n")}\n</cangjie_error_hints>`
}

// ---------------------------------------------------------------------------
// Error-classified AI fix directives
// ---------------------------------------------------------------------------

interface ErrorFixDirective {
	pattern: RegExp
	directive: string
}

const ERROR_FIX_DIRECTIVES: ErrorFixDirective[] = [
	{ pattern: /unused\s+(?:variable|import|parameter)/i, directive: "移除未使用的变量/导入/参数" },
	{ pattern: /(?:cannot find|undeclared|unresolved|not found|未找到符号)/i, directive: "检查是否缺少 import 语句或拼写错误。如果是标准库符号，添加正确的 import（如 `import std.collection.*`）" },
	{ pattern: /(?:type mismatch|incompatible types|类型不匹配)/i, directive: "使类型一致：修改变量类型、添加显式类型转换、或调整函数返回类型" },
	{ pattern: /(?:immutable|cannot assign|let.*reassign|不可变)/i, directive: "将 `let` 改为 `var`，或重构为不需要重新赋值的模式" },
	{ pattern: /(?:non-exhaustive|incomplete match|未穷尽)/i, directive: "为 match 表达式添加缺失的分支或 `case _ =>` 通配分支" },
	{ pattern: /(?:missing return|no return|缺少返回)/i, directive: "确保函数所有分支都有返回值，或在函数末尾添加返回语句" },
	{ pattern: /(?:not implement|missing implementation|未实现接口)/i, directive: "实现缺失的接口方法，确保方法签名完全匹配" },
	{ pattern: /(?:access.*denied|private|not accessible|访问权限)/i, directive: "检查访问修饰符，跨包使用需要 `public`" },
	{ pattern: /(?:cyclic dependency|循环依赖)/i, directive: "将共享类型抽取到独立包中以打破循环依赖" },
	{ pattern: /(?:duplicate.*definition|redefinition|重复定义)/i, directive: "移除重复定义，或为同名符号使用不同的名称" },
	{ pattern: /(?:syntax error|unexpected token|语法错误)/i, directive: "检查括号/花括号匹配，确保语句完整。注意仓颉不使用分号结尾" },
	{ pattern: /(?:override.*missing|must.*override)/i, directive: "在重写的方法前添加 `override` 关键字" },
	{ pattern: /(?:wrong number.*argument|too (?:many|few) argument|参数数量)/i, directive: "调整函数调用的参数数量或顺序以匹配函数声明" },
	{ pattern: /(?:constraint.*not satisfied|does not conform|泛型约束)/i, directive: "确保类型参数满足 where 子句中的约束" },
	{ pattern: /(?:mut function|mut.*let)/i, directive: "将 `let` 改为 `var` 以允许调用 mut 方法" },
	{ pattern: /(?:capture.*mutable|spawn.*var|并发.*可变)/i, directive: "使用 Mutex 或 AtomicReference 包装共享可变状态" },
]

/**
 * Given an error message, return a specific fix directive for the AI,
 * or a generic one if no pattern matches.
 */
export function getErrorFixDirective(errorMessage: string): string {
	for (const { pattern, directive } of ERROR_FIX_DIRECTIVES) {
		if (pattern.test(errorMessage)) {
			return `${directive} （切记：遇到模糊报错，务必要对其类型或发生错误的用法使用 grep_search 检索 manual/ 与 libs/ 内容查阅修正方案体系！）`
		}
	}
	return "深入报错根源，如果是没见过的编译错误，必须立刻调出 grep_search 前往 CangjieCorpus 语料库寻找相关错误的规范修复手段或 API 改动机制！然后再修代码！"
}

// ---------------------------------------------------------------------------
// Structured AI editing context
// ---------------------------------------------------------------------------

const HOVER_PROVIDER_TIMEOUT_MS = 800
const HOVER_TEXT_MAX_CHARS = 4000

function hoversToPlainText(hovers: vscode.Hover[]): string {
	const chunks: string[] = []
	for (const h of hovers) {
		for (const c of h.contents) {
			if (typeof c === "string") {
				chunks.push(c)
			} else {
				chunks.push((c as vscode.MarkdownString).value)
			}
		}
	}
	return chunks.join("\n\n").replace(/\r\n/g, "\n").trim()
}

/**
 * Best-effort LSP hover at cursor via VS Code command API (no direct LanguageClient).
 */
async function fetchHoverAtPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<string | null> {
	try {
		const task = vscode.commands.executeCommand(
			"vscode.executeHoverProvider",
			document.uri,
			position,
		) as Thenable<vscode.Hover[] | undefined>

		const hovers = await Promise.race([
			task,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), HOVER_PROVIDER_TIMEOUT_MS)),
		])
		if (!hovers?.length) return null
		const text = hoversToPlainText(hovers)
		if (!text) return null
		return text.length > HOVER_TEXT_MAX_CHARS ? `${text.slice(0, HOVER_TEXT_MAX_CHARS)}…` : text
	} catch {
		return null
	}
}

/**
 * Build a structured editing context for the AI when the user is actively
 * editing a Cangjie file. Includes file info, current function, imports,
 * LSP hover at cursor, nearby code, and recent diagnostics.
 */
export async function buildStructuredEditingContext(): Promise<string | null> {
	const editor = vscode.window.activeTextEditor
	if (!editor || (editor.document.languageId !== "cangjie" && !editor.document.fileName.endsWith(".cj"))) {
		return null
	}

	const doc = editor.document
	const position = editor.selection.active
	const cursorLine = position.line
	const content = doc.getText()
	const defs = parseCangjieDefinitions(content)

	const parts: string[] = []

	// File info
	const fileName = path.basename(doc.fileName)
	parts.push(`当前文件: ${fileName}`)

	// Imports
	const imports = extractImports(content)
	if (imports.length > 0) {
		parts.push(`已导入: ${imports.slice(0, 10).join(", ")}${imports.length > 10 ? " …" : ""}`)
	}

	// Current function/class context
	const enclosing = defs
		.filter((d: CangjieDef) => d.startLine <= cursorLine && d.endLine >= cursorLine && d.kind !== "import" && d.kind !== "package")
		.sort((a: CangjieDef, b: CangjieDef) => (b.startLine - a.startLine))

	if (enclosing.length > 0) {
		const innermost = enclosing[0]
		const lines = content.split("\n")
		const sig = computeCangjieSignature(lines, innermost)
		parts.push(`正在编辑: ${innermost.kind} ${innermost.name} (第 ${innermost.startLine + 1} 行)`)
		parts.push(`签名: ${sig}`)
	}

	const hover = await fetchHoverAtPosition(doc, position)
	if (hover) {
		parts.push(`光标处 LSP 提示:\n${hover}`)
	}

	// Nearby code (±5 lines around cursor)
	const startLine = Math.max(0, cursorLine - 5)
	const endLine = Math.min(doc.lineCount - 1, cursorLine + 5)
	const nearbyLines: string[] = []
	for (let i = startLine; i <= endLine; i++) {
		const marker = i === cursorLine ? " >>>" : "    "
		nearbyLines.push(`${marker} ${i + 1}: ${doc.lineAt(i).text}`)
	}
	parts.push(`附近代码:\n${nearbyLines.join("\n")}`)

	// Active diagnostics for this file
	const diags = vscode.languages.getDiagnostics(doc.uri)
	const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
	if (errors.length > 0) {
		const errorSummary = errors.slice(0, 5).map((d) => {
			const directive = getErrorFixDirectiveForDiagnostic(d)
			return `  - 第 ${d.range.start.line + 1} 行: ${d.message}\n    建议: ${directive}`
		}).join("\n")
		parts.push(`当前文件错误:\n${errorSummary}`)
	}

	return `## 当前编辑上下文\n\n${parts.join("\n")}`
}

// Re-export for testing
export {
	extractImports,
	mapImportsToDocPaths,
	CJC_ERROR_PATTERNS,
	STDLIB_DOC_MAP,
	parseCjpmToml,
	scanPackageHierarchy,
	resolveImportedSymbols,
	verifyPackageDeclarations,
	buildWorkspaceSymbolSummary,
}
