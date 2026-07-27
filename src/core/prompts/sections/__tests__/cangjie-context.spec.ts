import { describe, it, expect, vi } from "vitest"

const cangjieTestState = vi.hoisted(() => ({
	diagnostics: [] as Array<[any, any[]]>,
	activeTextEditor: null as any,
	activeInfo: null as any,
	rootCause: vi.fn(),
	symbolIndex: null as any,
}))

vi.mock("vscode", () => ({
	window: {
		visibleTextEditors: [],
		get activeTextEditor() {
			return cangjieTestState.activeTextEditor
		},
	},
	languages: {
		getDiagnostics: () => cangjieTestState.diagnostics,
	},
	workspace: {
		getConfiguration: () => ({
			get: (_key: string, fallback: unknown) => fallback,
		}),
		textDocuments: [],
	},
	commands: {
		executeCommand: vi.fn(),
	},
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
	Range: class Range {
		start: { line: number; character: number }
		end: { line: number; character: number }
		constructor(s: number, sc: number, e: number, ec: number) {
			this.start = { line: s, character: sc }
			this.end = { line: e, character: ec }
		}
	},
	Diagnostic: class Diagnostic {
		message: string
		severity: number
		range: InstanceType<typeof Range>
		code?: string | number
		constructor(range: InstanceType<typeof Range>, message: string, severity: number) {
			this.range = range
			this.message = message
			this.severity = severity
		}
	},
}))

vi.mock("../CangjieErrorAnalyzer", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../CangjieErrorAnalyzer")>()
	return {
		...actual,
		normalizeDiagnosticCode: (diagnostic: any) => (diagnostic.code == null ? undefined : String(diagnostic.code)),
		resolveCjcPatternForDiagnostic: (diagnostic: any) =>
			/type mismatch|expected/i.test(diagnostic.message)
				? {
						category: "Type mismatch",
						suggestion: "Convert the value before assignment.",
						docPaths: ["types/conversion.md"],
						priority: 90,
					}
				: undefined,
		buildDiagnosticPatternCache: (diagnostics: any[]) =>
			new Map(
				diagnostics.map((diagnostic) => [
					diagnostic,
					{ priority: /high priority/i.test(diagnostic.message) ? 100 : 10 },
				]),
			),
	}
})

vi.mock("../CangjieSymbolExtractor", () => ({
	collectActiveCangjieEditorSnapshot: () => ({
		imports: [] as string[],
		symbols: null,
		activePreparse: undefined,
	}),
	getActiveCangjieFileInfo: () => cangjieTestState.activeInfo,
}))

vi.mock("../../../../services/cangjie-lsp/cangjieDiagnosticRootCause", () => ({
	traceDiagnosticRootCause: cangjieTestState.rootCause,
}))

vi.mock("../../../../services/cangjie-lsp/CangjieSymbolIndex", () => ({
	CangjieSymbolIndex: {
		getInstance: () => cangjieTestState.symbolIndex,
	},
}))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"

import { estimateCangjieContextTokensForTest, extractImports, getCangjieContextSection } from "../cangjie-context"
import {
	buildAutoCorpusQueries,
	buildCorpusExtraFewShotSection,
	buildStdlibSignatureHintsSection,
	diagnosticToCorpusQuery,
	importPathToCorpusQuery,
} from "../cangjieContext/corpusQueryBuilding"
import {
	buildCompactProjectOverviewSection,
	parseCjpmToml,
	parseCjpmTomlContent,
	readWorkspaceMemberDependencies,
	scanPackageHierarchy,
} from "../cangjieContext/cjpmProjectParser"
import {
	buildConversionHintByMessage,
	buildDiagnosticAugmentationLines,
	collectDiagnosticSnapshot,
	diagnosticTypeFingerprint,
	mapDiagnosticsToDocContext,
	normalizeDiagnosticMessageForAggregation,
	sampleCangjieDiagnostics,
} from "../cangjieContext/diagnosticHandling"
import { testLearnedFixPatternMatchesMessage, testNormalizeLearnedFixText } from "../cangjieContext/learnedFixMatching"
import { userMessageSuggestsCangjie } from "../cangjieContext/cacheManagement"

const makeDiagnostic = (
	message: string,
	severity: number = vscode.DiagnosticSeverity.Error,
	line = 0,
	code?: string | number,
) => {
	const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 5), message, severity as any)
	diagnostic.code = code
	return diagnostic
}

describe("userMessageSuggestsCangjie (Ask/Architect 语料触发)", () => {
	it("matches toolchain tokens and 仓颉", () => {
		expect(userMessageSuggestsCangjie("如何用 cjpm build")).toBe(true)
		expect(userMessageSuggestsCangjie("仓颉的泛型怎么写")).toBe(true)
		expect(userMessageSuggestsCangjie("read foo.cj file")).toBe(true)
	})
	it("returns false for unrelated text", () => {
		expect(userMessageSuggestsCangjie("hello world")).toBe(false)
		expect(userMessageSuggestsCangjie(undefined)).toBe(false)
	})
})

describe("estimateCangjieContextTokensForTest", () => {
	it("中英文内容均产生正 token 估计", () => {
		const zh = estimateCangjieContextTokensForTest("仓颉语言类型系统")
		const en = estimateCangjieContextTokensForTest("cangjie language type system")
		expect(zh).toBeGreaterThan(0)
		expect(en).toBeGreaterThan(0)
	})

	it("代码符号应产生可见 token 成本", () => {
		const plain = estimateCangjieContextTokensForTest("abcdef")
		const code = estimateCangjieContextTokensForTest("Map<String, Int64> {}")
		expect(code).toBeGreaterThan(plain)
	})

	it("空文本返回 0", () => {
		expect(estimateCangjieContextTokensForTest("")).toBe(0)
	})
})

describe("learned-fix similarity (Cangjie Dev)", () => {
	it("normalizes file paths and line numbers for stable matching", () => {
		const a = testNormalizeLearnedFixText("Error at D:\\proj\\src\\foo.cj:42:10 type mismatch")
		const b = testNormalizeLearnedFixText("Error at E:\\other\\bar.cj:99:1 type mismatch")
		expect(a).toContain("FILE")
		expect(a).toContain(":L:L")
		expect(a.replace(/FILE/g, "X")).toBe(b.replace(/FILE/g, "X"))
	})

	it("matches bilingual type mismatch with lowered threshold", () => {
		const p = {
			errorPattern: "type mismatch: expected Int32, found String",
			fix: "cast or parse",
		}
		const ok = testLearnedFixPatternMatchesMessage(p, "类型不匹配：需要 Int32 但得到了 String")
		expect(ok).toBe(true)
	})

	it("matches when diagnostic code equals bracket tag in pattern", () => {
		const p = { errorPattern: "[E1234] something failed", fix: "x" }
		expect(testLearnedFixPatternMatchesMessage(p, "unrelated text", "E1234")).toBe(true)
	})

	it("honors optional diagnosticCode on learned pattern", () => {
		const p = { errorPattern: "any", fix: "x", diagnosticCode: "E42" }
		expect(testLearnedFixPatternMatchesMessage(p, "msg", "E42")).toBe(true)
		expect(testLearnedFixPatternMatchesMessage(p, "msg", "E99")).toBe(false)
	})
})

describe("extractImports (brace syntax)", () => {
	it("captures package prefix for import pkg.{ ... }", () => {
		const src = `
import std.io.{InputStream, OutputStream}
from std.collection import HashMap
import std.console.*
`
		const im = extractImports(src)
		expect(im).toContain("std.io")
		expect(im).toContain("std.collection")
		expect(im).toContain("std.console")
	})
})

describe("getCangjieContextSection mode rules", () => {
	it("instructs Cangjie mode not to switch to Code mode for shell integration fallback", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cangjie-context-"))
		try {
			fs.writeFileSync(
				path.join(root, "cjpm.toml"),
				`
[package]
name = "demo"
version = "0.1.0"
output-type = "executable"
`,
				"utf-8",
			)

			const section = await getCangjieContextSection(root, "cangjie", undefined, 1200)

			expect(section).toContain("Cangjie Mode Toolchain Rules")
			expect(section).toContain("Cangjie Context Injection Audit")
			expect(section).toContain("toolchain-rules")
			expect(section).toContain("project-overview")
			expect(section).toContain("Use this audit when evaluating which context sources influenced")
			expect(section).toContain("If the user asks only which Cangjie context was injected")
			expect(section).toContain("answer only with this context audit/list and stop")
			expect(section).toContain("do not add project status")
			expect(section).toContain("directory trees")
			expect(section).toContain("source-file lists")
			expect(section).toContain("current-symbol summaries")
			expect(section).toContain("project diagnostics")
			expect(section).toContain("stdlib-signature-hints")
			expect(section).toContain("must not be used by itself to claim stdlib API correctness")
			expect(section).toContain(
				"CangjieExplore -> CangjieImplement -> CangjieVerify -> CangjieRepair -> CangjieVerify",
			)
			expect(section).toContain("Use CangjieExplore for project/corpus evidence")
			expect(section).toContain("asks only for corpus evidence")
			expect(section).toContain("stop after the evidence/plan report")
			expect(section).toContain("Do not ask follow-up questions about implementation details")
			expect(section).toContain("Evidence collected; no files were modified")
			expect(section).toContain("Do not print the full final evidence report as an ordinary assistant message")
			expect(section).toContain("attempt_completion.result")
			expect(section).toContain("attempt_completion")
			expect(section).toContain("do not resubmit the same long report")
			expect(section).toContain("use the exact heading `Cangjie evidence audit:`")
			expect(section).toContain("do not infer undocumented type relationships")
			expect(section).toContain("Byte/UInt8 compatibility")
			expect(section).toContain("libs/std/fs/fs_samples/file_samples.md")
			expect(section).toContain("official sample pattern outweighs isolated signature comparison")
			expect(section).toContain("如需开始编写代码")
			expect(section).toContain("explicitly forbids corpus search")
			expect(section).toContain("do not perform those actions to satisfy Cangjie evidence gates")
			expect(section).toContain("blocked/inconclusive under the user's constraints")
			expect(section).toContain("不要查语料库")
			expect(section).toContain("不要查 LSP")
			expect(section).toContain("API correctness cannot be confirmed under the user's constraints")
			expect(section).toContain("Do not skip CangjieVerify")
			expect(section).toContain("compare the newest build diagnostics")
			expect(section).toContain("If diagnostics stagnate")
			expect(section).toContain("stop blind edits")
			expect(section).toContain("fresh corpus/LSP evidence")
			expect(section).toContain("Do not switch to Code mode")
			expect(section).toContain("create a Code subtask")
			expect(section).toContain("cjpm build")
			expect(section).toContain("cjlint")
			expect(section).toContain("Invoke Cangjie toolchain commands directly")
			expect(section).toContain("Do not wrap them in shell directory switches")
			expect(section).toContain("cd /d ... && cjpm build")
			expect(section).toContain("project-cwd resolver")
			expect(section).toContain("read_command_output")
			expect(section).toContain("cmd.exe prefer `where.exe cjpm`")
			expect(section).toContain("PowerShell use `Get-Command cjpm`")
			expect(section).toContain("Do not replace toolchain verification with speculative static analysis")
			expect(section).toContain("report verification as inconclusive")
			expect(section).toContain("do not retry through PowerShell/cmd wrappers")
			expect(section).toContain("do not ask the user to paste terminal output")
			expect(section).toContain("do not tell the user to manually run the same verification command")
			expect(section).toContain("Explicit command allowlists override normal project-confirmation")
			expect(section).toContain("do not read `cjpm.toml`")
			expect(section).toContain("do not even announce or plan extra probes")
			expect(section).toContain("checking whether `cjpm.toml` exists")
			expect(section).toContain("explicitly limits verification to specific commands")
			expect(section).toContain("Do not add fallback commands")
			expect(section).toContain("Keep an execution ledger")
			expect(section).toContain("Only report a command as attempted if you actually invoked that exact command")
			expect(section).toContain("run each allowed command at most once")
			expect(section).toContain("timeout, shell integration warning, or unavailable execute_command result")
			expect(section).toContain("do not run `where cjpm`, `Get-Command cjpm`, or `powershell -Command ...`")
			expect(section).toContain("do not run `cjpm build`, `cd /d ... && cjpm build`, or any PowerShell wrapper")
			expect(section).toContain("terminal shell integration warning")
			expect(section).toContain("do not rewrite or retry the command")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it("injects a task-specific agent route without reusing a stale route", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cangjie-route-"))
		try {
			fs.writeFileSync(
				path.join(root, "cjpm.toml"),
				`[package]\nname = "demo"\nversion = "0.1.0"\noutput-type = "executable"\n`,
				"utf-8",
			)

			const exploreSection = await getCangjieContextSection(
				root,
				"cangjie",
				undefined,
				2000,
				undefined,
				"调查 HashMap 证据，不修改文件",
			)
			const verifySection = await getCangjieContextSection(
				root,
				"cangjie",
				undefined,
				2000,
				undefined,
				"只运行 cjpm build 验证项目",
			)

			expect(exploreSection).toContain("## Cangjie Agent Route")
			expect(exploreSection).toContain("Required stages: CangjieExplore")
			expect(verifySection).toContain("Required stages: CangjieVerify")
			expect(verifySection).not.toContain("Required stages: CangjieExplore\n")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("Cangjie agent route retention", () => {
	it("keeps the verify route at the minimum context budget", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cangjie-tight-route-"))
		try {
			fs.writeFileSync(
				path.join(root, "cjpm.toml"),
				`[package]\nname = "demo"\nversion = "0.1.0"\noutput-type = "executable"\n`,
				"utf-8",
			)

			const section = await getCangjieContextSection(
				root,
				"cangjie",
				undefined,
				500,
				undefined,
				"\u53ea\u8fd0\u884c cjpm build \u9a8c\u8bc1\u9879\u76ee",
			)

			expect(section).toContain("Required stages: CangjieVerify")
			expect(section).toContain("agent-route")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("corpus query building", () => {
	it("converts import paths into compact search terms", () => {
		expect(importPathToCorpusQuery("std.collection.HashMap")).toBe("collection HashMap")
		expect(importPathToCorpusQuery("std.console.*")).toBe("std console")
		expect(importPathToCorpusQuery("*")).toBeNull()
		expect(importPathToCorpusQuery("LocalModule")).toBe("LocalModule")
	})

	it("derives diagnostic queries from plain messages", () => {
		const diagnostic = {
			message: "error: custom package foo failed at line 42 because helper token vanished",
		} as any

		const query = diagnosticToCorpusQuery(diagnostic)

		expect(query).toContain("custom")
		expect(query).toContain("package")
		expect(query).not.toContain("42")
	})

	it("groups std imports by family and limits merged queries", () => {
		const diagnostics = [
			{ message: "error: undeclared identifier println" },
			{ message: "warning: type mismatch expected Int64 found String" },
		] as any[]

		const queries = buildAutoCorpusQueries(
			[
				"std.collection.HashMap",
				"std.collection.ArrayList",
				"std.io.File",
				"my.project.LocalType",
				"other.module.Helper",
			],
			diagnostics,
		)

		expect(queries.length).toBeLessThanOrEqual(5)
		expect(queries.some((q) => q.includes("collection HashMap"))).toBe(true)
		expect(queries.some((q) => q.includes("io File"))).toBe(true)
		expect(queries.some((q) => q.includes("project LocalType"))).toBe(true)
		expect(queries.at(-1)?.length).toBeGreaterThan(0)
	})

	it("returns stdlib signature hints for matching standard imports", async () => {
		const section = await buildStdlibSignatureHintsSection(
			["std.collection.HashMap", "std.io.File", "local.Project"],
			null,
		)

		expect(section).toBeTruthy()
		expect(section).toContain("std.collection")
		expect(section).toContain("func add(T): Unit")
		expect(section).toContain("func add(T, at!: Int64): Unit")
		expect(section).toContain("do not borrow append/insert")
		expect(section).not.toContain("func append(T): Unit")
		expect(section).toContain("func add(K, V): Option<V>")
		expect(section).toContain("func contains(K): Bool")
		expect(section).toContain("operator [](K, value!: V): Unit")
		expect(section).toContain("prefer get(...) plus add(...)")
		expect(section).toContain("must not evaluate let/var mutability semantics")
		expect(section).toContain("no let/var semantic conclusion is made here")
		expect(section).not.toContain("not mut func add")
		expect(section).not.toContain("let is valid/recommended")
		expect(section).toContain("HashMap 样例使用 var 或 HashMap 是引用类型")
		expect(section).toContain("add 必须 var")
		expect(section).toContain("let 可以调用 add")
		expect(section).toContain("let 更推荐")
	})

	it("uses corpus-confirmed signatures for fs regex time and process", async () => {
		const section = await buildStdlibSignatureHintsSection(
			["std.fs.File", "std.regex.Regex", "std.time.DateTime", "std.process"],
			null,
		)

		expect(section).toContain("File.readFrom")
		expect(section).toContain("Array<Byte>")
		expect(section).toContain("MatchData")
		expect(section).toContain("matchString()")
		expect(section).toContain("Do not invent a default MatchData constructor")
		expect(section).toContain("DateTime.nowUTC")
		expect(section).toContain("TimeZone.load")
		expect(section).toContain("executeWithOutput")
		expect(section).toContain("String.fromUtf8")
	})

	it("includes Option signatures for std.core imports", async () => {
		const section = await buildStdlibSignatureHintsSection(["std.core.Option"], null)

		expect(section).toContain("std.core")
		expect(section).toContain("enum Option<T>")
		expect(section).toContain("?T is equivalent to Option<T>")
		expect(section).toContain("getOrDefault")
		expect(section).toContain("getOrThrow")
		expect(section).toContain("isSome")
		expect(section).toContain("isNone")
	})

	it("omits stdlib signature hints when no std imports match", async () => {
		await expect(buildStdlibSignatureHintsSection(["local.Project"], null)).resolves.toBeNull()
	})

	it("uses the last user hint to inject common API extra cards before imports exist", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-corpus-extra-"))
		try {
			fs.mkdirSync(path.join(root, "extra"), { recursive: true })
			fs.writeFileSync(
				path.join(root, "extra", "HashMap.md"),
				"# HashMap\n\nimport std.collection.*\nvar map: HashMap<String, Int64> = HashMap<String, Int64>()",
				"utf-8",
			)

			const section = await buildCorpusExtraFewShotSection(root, [], [], "add a HashMap helper")

			expect(section).toContain("extra/HashMap.md")
			expect(section).toContain("HashMap<String, Int64>")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it("uses the last user hint to point file and regex tasks at corpus docs", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-corpus-refs-"))
		try {
			fs.mkdirSync(path.join(root, "libs", "std", "fs", "fs_samples"), { recursive: true })
			fs.mkdirSync(path.join(root, "libs", "std", "regex", "regex_samples"), { recursive: true })
			fs.writeFileSync(path.join(root, "libs", "std", "fs", "fs_samples", "file_samples.md"), "# file", "utf-8")
			fs.writeFileSync(
				path.join(root, "libs", "std", "regex", "regex_samples", "regex_sample.md"),
				"# regex",
				"utf-8",
			)

			const section = await buildCorpusExtraFewShotSection(root, [], [], "read file and regex match")

			expect(section).toContain("libs/std/fs/fs_samples/file_samples.md")
			expect(section).toContain("libs/std/regex/regex_samples/regex_sample.md")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it("uses dedicated File and Regex extra cards when those cards are bundled", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-corpus-api-cards-"))
		try {
			fs.mkdirSync(path.join(root, "extra"), { recursive: true })
			fs.writeFileSync(
				path.join(root, "extra", "File.md"),
				"# File\n\nFile.readFrom returns Array<Byte>.",
				"utf-8",
			)
			fs.writeFileSync(
				path.join(root, "extra", "Regex.md"),
				"# Regex\n\nRegex(...).matches(input)\nfind(input: String, group!: Bool = false): Option<MatchData>",
				"utf-8",
			)

			const section = await buildCorpusExtraFewShotSection(root, [], [], "read file and regex match")

			expect(section).toContain("extra/File.md")
			expect(section).toContain("File.readFrom returns Array<Byte>")
			expect(section).toContain("extra/Regex.md")
			expect(section).toContain("Regex(...).matches(input)")
			expect(section).toContain("find(input: String")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it("uses dedicated Time and Process extra cards when those cards are bundled", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-corpus-more-api-cards-"))
		try {
			fs.mkdirSync(path.join(root, "extra"), { recursive: true })
			fs.writeFileSync(path.join(root, "extra", "Time.md"), "# Time\n\nDateTime.nowUTC()", "utf-8")
			fs.writeFileSync(
				path.join(root, "extra", "Process.md"),
				"# Process\n\nexecuteWithOutput returns bytes.",
				"utf-8",
			)

			const section = await buildCorpusExtraFewShotSection(
				root,
				[],
				[],
				"format DateTime and run process with executeWithOutput",
			)

			expect(section).toContain("extra/Time.md")
			expect(section).toContain("DateTime.nowUTC()")
			expect(section).toContain("extra/Process.md")
			expect(section).toContain("executeWithOutput returns bytes")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it("points Option tasks at the extra card and core enum docs", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-corpus-option-card-"))
		try {
			fs.mkdirSync(path.join(root, "extra"), { recursive: true })
			fs.mkdirSync(path.join(root, "libs", "std", "core", "core_package_api"), { recursive: true })
			fs.writeFileSync(
				path.join(root, "extra", "Option.md"),
				"# Option\n\nUse Some/None and getOrDefault.",
				"utf-8",
			)
			fs.writeFileSync(
				path.join(root, "libs", "std", "core", "core_package_api", "core_package_enums.md"),
				"# enum Option<T>\n\npublic enum Option<T> { Some(T) | None }",
				"utf-8",
			)

			const section = await buildCorpusExtraFewShotSection(root, [], [], "handle None with getOrDefault")

			expect(section).toContain("extra/Option.md")
			expect(section).toContain("Use Some/None and getOrDefault")
			expect(section).toContain("libs/std/core/core_package_api/core_package_enums.md")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("parseCjpmToml (smol-toml + fallback)", () => {
	it("reads package fields from valid TOML", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cjpm-"))
		try {
			fs.writeFileSync(
				path.join(dir, "cjpm.toml"),
				`
[package]
name = "demo_pkg"
version = "0.2.0"
output-type = "executable"
src-dir = "src2"

# trailing comment
`,
				"utf-8",
			)
			const info = await parseCjpmToml(dir)
			expect(info?.name).toBe("demo_pkg")
			expect(info?.version).toBe("0.2.0")
			expect(info?.srcDir).toBe("src2")
			expect(info?.isWorkspace).toBe(false)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it("parses multiline string in workspace member dependency (smol path)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-ws-"))
		try {
			const mod = path.join(root, "core")
			fs.mkdirSync(mod, { recursive: true })
			fs.writeFileSync(
				path.join(root, "cjpm.toml"),
				`
[workspace]
members = [ "core" ]

[dependencies]
rootdep = { path = "./x" }
`,
				"utf-8",
			)
			fs.writeFileSync(
				path.join(mod, "cjpm.toml"),
				`
[package]
name = "core"
output-type = "static"

[dependencies]
peer = { path = "../peer" }
`,
				"utf-8",
			)
			const info = await parseCjpmToml(root)
			expect(info?.isWorkspace).toBe(true)
			expect(info?.members?.length).toBeGreaterThanOrEqual(1)
			const core = info?.members?.find((m) => m.name === "core")
			expect(core?.outputType).toBe("static")
			expect(core?.dependencies?.peer?.path).toBe("../peer")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("diagnostic handling", () => {
	it("builds stable fingerprints from quoted and primitive types", () => {
		expect(diagnosticTypeFingerprint("expected `Foo Bar` but got `Baz`")).toBe("foobar|baz")
		expect(diagnosticTypeFingerprint("expected Int64 but got String and Int64")).toBe("int64|string")
		expect(diagnosticTypeFingerprint("plain message")).toBe("")
	})

	it("normalizes diagnostic messages for aggregation", () => {
		const normalized = normalizeDiagnosticMessageForAggregation(
			"[E001] D:\\proj\\src\\main.cj: type mismatch expected `Foo Bar`",
		)

		expect(normalized).not.toContain("D:\\proj")
		expect(normalized).not.toContain("[E001]")
		expect(normalized).toContain("type mismatch")
		expect(normalized).toContain("foobar")
	})

	it("collects Cangjie diagnostics and ignores non-Cangjie files", () => {
		const cjUri = { fsPath: path.join("D:", "proj", "main.cj"), toString: () => "file:///D:/proj/main.cj" }
		const tsUri = { fsPath: path.join("D:", "proj", "main.ts"), toString: () => "file:///D:/proj/main.ts" }
		const diagnostic = makeDiagnostic("type mismatch expected Int64", vscode.DiagnosticSeverity.Error, 3, "E001")
		cangjieTestState.diagnostics = [
			[cjUri, [diagnostic]],
			[tsUri, [makeDiagnostic("ignored")]],
		]

		const snapshot = collectDiagnosticSnapshot()

		expect(snapshot.allCjDiags).toEqual([diagnostic])
		expect(snapshot.byFile.size).toBe(1)
		expect(snapshot.diagSummaryHash).toBeGreaterThan(0)
		cangjieTestState.diagnostics = []
	})

	it("samples diagnostics by severity, aggregation bucket, and limits", () => {
		const first = makeDiagnostic(
			"high priority type mismatch expected Int64",
			vscode.DiagnosticSeverity.Error,
			0,
			"E1",
		)
		const duplicate = makeDiagnostic(
			"high priority type mismatch expected Int64",
			vscode.DiagnosticSeverity.Error,
			2,
			"E1",
		)
		const warning = makeDiagnostic("warning: unused value", vscode.DiagnosticSeverity.Warning, 5, "W1")
		const info = makeDiagnostic("info only", vscode.DiagnosticSeverity.Information, 7, "I1")

		const result = sampleCangjieDiagnostics([warning, info, duplicate, first], { maxErrors: 1, maxWarnings: 1 })

		expect(result.total).toBe(4)
		expect(result.sampled).toHaveLength(2)
		expect(result.sampled[0]?.message).toContain("high priority")
		expect(result.sampled[0]?.message).toContain("2")
		expect(result.sampled[1]).toBe(warning)
		expect(result.omitted).toBe(1)
	})

	it("maps diagnostics to doc context and conversion hints", () => {
		const diagnostic = makeDiagnostic("type mismatch expected String", vscode.DiagnosticSeverity.Error, 0, "E001")
		const lines = mapDiagnosticsToDocContext(
			[diagnostic, diagnostic],
			"D:\\docs",
			new Map([[diagnostic.message, "Try String.from(value)."]]),
		)

		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("Type mismatch")
		expect(lines[0]).toContain("code: E001")
		expect(lines[0]).toContain("types/conversion.md")
		expect(lines[0]).toContain("Try String.from(value).")
	})

	it("adds root-cause and conversion augmentation lines once", () => {
		const diagnostic = makeDiagnostic("type mismatch expected String", vscode.DiagnosticSeverity.Error, 0, "E002")
		cangjieTestState.rootCause.mockReturnValue("root declaration has incompatible type")

		const lines = buildDiagnosticAugmentationLines(
			[diagnostic, diagnostic],
			"D:\\proj",
			new Map([[diagnostic.message, "Use explicit conversion."]]),
			new Map(),
		)

		expect(lines).toEqual(["- root declaration has incompatible type", "- Use explicit conversion."])
		cangjieTestState.rootCause.mockReset()
	})

	it("builds conversion hints only for matching diagnostic messages", () => {
		cangjieTestState.symbolIndex = {
			getConversionHintFromDiagnosticMessage: vi.fn((message: string) =>
				message.includes("String") ? "Use String.from" : undefined,
			),
		}

		const matching = makeDiagnostic("type mismatch expected String", vscode.DiagnosticSeverity.Error)
		const ignored = makeDiagnostic("unrelated parser error", vscode.DiagnosticSeverity.Error)
		const hints = buildConversionHintByMessage([matching, ignored])

		expect(hints.get(matching.message)).toBe("Use String.from")
		expect(hints.has(ignored.message)).toBe(false)
		cangjieTestState.symbolIndex = null
	})
})

describe("cjpm project parser helpers", () => {
	it("parses package dependencies from TOML content without reading files", async () => {
		const info = await parseCjpmTomlContent(
			`
[package]
name = "demo"
version = "1.2.3"
output-type = "static"
src-dir = "source"

[dependencies]
local = { path = "../local" }
remote = { git = "https://example.test/repo.git", branch = "main" }
tagged = { git = "https://example.test/repo.git", tag = "v1" }
`,
			process.cwd(),
		)

		expect(info).toMatchObject({
			name: "demo",
			version: "1.2.3",
			outputType: "static",
			srcDir: "source",
			isWorkspace: false,
		})
		expect(info?.dependencies?.local?.path).toBe("../local")
		expect(info?.dependencies?.remote?.branch).toBe("main")
		expect(info?.dependencies?.tagged?.tag).toBe("v1")
	})

	it("reads dependency display from member metadata before touching files", async () => {
		const deps = await readWorkspaceMemberDependencies(process.cwd(), {
			name: "core",
			path: "core",
			outputType: "static",
			dependencyDisplay: ["a", "b", "c", "d", "e", "f"],
		})

		expect(deps).toEqual(["a", "b", "c", "d", "e"])
	})

	it("scans package hierarchy with source, test, main, and child packages", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cjpm-scan-"))
		const leaf = path.join(root, "src", "network", "http")
		fs.mkdirSync(leaf, { recursive: true })
		fs.writeFileSync(path.join(root, "src", "main.cj"), "main() {}", "utf-8")
		fs.writeFileSync(path.join(root, "src", "main_test.cj"), "test {}", "utf-8")
		fs.writeFileSync(path.join(leaf, "client.cj"), "package demo.network.http", "utf-8")

		const tree = await scanPackageHierarchy(root, "src", "demo")

		expect(tree).toMatchObject({
			packageName: "demo",
			dirPath: "src",
			sourceFiles: ["main.cj"],
			testFiles: ["main_test.cj"],
			hasMain: true,
		})
		expect(tree?.children[0]?.children[0]).toMatchObject({
			packageName: "demo.network.http",
			dirPath: "src/network/http",
			sourceFiles: ["client.cj"],
		})
	})

	it("builds a compact overview for single-module projects", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cjpm-overview-"))
		fs.mkdirSync(path.join(root, "src", "sub"), { recursive: true })
		fs.writeFileSync(path.join(root, "src", "main.cj"), "main() {}", "utf-8")
		fs.writeFileSync(path.join(root, "src", "sub", "helper.cj"), "package demo.sub", "utf-8")

		const section = await buildCompactProjectOverviewSection(
			root,
			{
				name: "demo",
				version: "0.1.0",
				outputType: "executable",
				isWorkspace: false,
				srcDir: "src",
			},
			"demo.sub",
			path.join(root, "src", "sub", "helper.cj"),
		)

		expect(section).toContain("demo")
		expect(section).toContain("executable")
		expect(section).toContain("src/")
		expect(section).toContain("demo.sub")
	})

	it("marks the active workspace member in the compact project overview", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "njust-ai-cjpm-workspace-overview-"))
		const alphaSrc = path.join(root, "alpha", "src")
		const betaSrc = path.join(root, "beta", "src")
		fs.mkdirSync(alphaSrc, { recursive: true })
		fs.mkdirSync(betaSrc, { recursive: true })
		fs.writeFileSync(path.join(alphaSrc, "main.cj"), "package alpha", "utf-8")
		fs.writeFileSync(path.join(betaSrc, "main.cj"), "package beta", "utf-8")

		const section = await buildCompactProjectOverviewSection(
			root,
			{
				name: "",
				version: "",
				outputType: "",
				isWorkspace: true,
				srcDir: "src",
				members: [
					{ name: "alpha", path: "alpha", outputType: "executable" },
					{ name: "beta", path: "beta", outputType: "dynamic" },
				],
			},
			"beta",
			path.join(betaSrc, "main.cj"),
		)

		expect(section).toContain("项目: workspace (2 个模块)")
		expect(section).toContain("- alpha (executable): 1 源/0 测")
		expect(section).toContain("- beta (dynamic): 1 源/0 测 ← 当前编辑模块")
		expect(section).toContain("当前编辑包: beta")
		expect(section).not.toContain("alpha (executable): 1 源/0 测 ← 当前编辑模块")
	})
})
