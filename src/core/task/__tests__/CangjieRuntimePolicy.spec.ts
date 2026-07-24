import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import fs from "fs/promises"
import os from "os"
import path from "path"

vi.mock("vscode", () => ({
	window: {
		visibleTextEditors: [],
		activeTextEditor: null,
	},
	languages: {
		getDiagnostics: () => [],
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

import {
	CangjieRuntimePolicy,
	buildStdModuleEvidenceSuggestions,
	isAllowedCangjieCommand,
	summarizeCangjieBuildFailure,
} from "../CangjieRuntimePolicy"

describe("CangjieRuntimePolicy", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "njust-ai-cangjie-policy-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("blocks .cj writes before cjpm project initialization", async () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		await expect(policy.ensureProjectInitializedForWrite("src/main.cj")).resolves.toContain("cjpm project")
		await expect(policy.ensureProjectInitializedForWrite("README.md")).resolves.toBeNull()
	})

	it("enforces the configured Cangjie agent route in parent tasks", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		policy.configureAgentRoute("新增 tripleValue 函数并编译验证")

		expect(policy.validateAgentStageToolUse("read_file")).toContain('"CangjieExplore"')
		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieImplement" })).toContain(
			'requires agentType "CangjieExplore"',
		)
		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieExplore" })).toBeNull()

		policy.noteAgentDelegation("CangjieExplore")
		expect(policy.validateAgentStageToolUse("apply_patch")).toContain('"CangjieImplement"')
		policy.noteAgentDelegation("CangjieImplement")
		expect(policy.validateAgentStageToolUse("execute_command")).toContain('"CangjieVerify"')
		policy.noteAgentDelegation("CangjieVerify")
		expect(policy.validateAgentStageToolUse("attempt_completion")).toBeNull()
	})

	it("does not enforce parent routing inside delegated agent contexts", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		policy.configureAgentRoute("新增函数")

		expect(policy.validateAgentStageToolUse("read_file", {}, true)).toBeNull()
		expect(policy.validateAgentStageToolUse("apply_patch", {}, true)).toBeNull()
	})

	it("blocks Cangjie source deletion unless the user explicitly requested it", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.configureAgentRoute("fix the package mismatch")
		expect(policy.getSourceDeletionBlockReason("src/foo/bar.cj")).toContain("source deletion blocked")
		expect(policy.getSourceDeletionBlockReason("notes.md")).toBeNull()

		policy.configureAgentRoute("delete src/foo/bar.cj")
		expect(policy.getSourceDeletionBlockReason("src/foo/bar.cj")).toBeNull()
	})

	it("allows .cj writes after cjpm.toml exists", async () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		await fs.writeFile(path.join(tempDir, "cjpm.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n', "utf8")
		policy.invalidateProjectCache()

		await expect(policy.ensureProjectInitializedForWrite("src/main.cj")).resolves.toBeNull()
	})

	it("validates Cangjie source layout and package declarations", async () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		await fs.mkdir(path.join(tempDir, "src", "foo"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "cjpm.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n', "utf8")
		policy.invalidateProjectCache()

		await expect(
			policy.validateProjectStructureForWrite("main.cj", "package demo\nmain(): Int64 { return 0 }\n"),
		).resolves.toContain("Allowed source roots")
		await expect(
			policy.validateProjectStructureForWrite("src/foo/bar.cj", "package wrong\nclass A {}\n"),
		).resolves.toContain('expected "package demo.foo"')
		await expect(
			policy.validateProjectStructureForWrite("src/foo/bar.cj", "package demo.foo\nclass A {}\n"),
		).resolves.toBeNull()
		await expect(
			policy.validateProjectStructureForWrite("src/main.cj", "package demo\nmain(): Int64 { return 0 }\n"),
		).resolves.toBeNull()
	})

	it("includes the workspace member package name in nested source packages", async () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		await fs.mkdir(path.join(tempDir, "member", "src", "feature"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "cjpm.toml"), '[workspace]\nmembers = ["member"]\n', "utf8")
		await fs.writeFile(
			path.join(tempDir, "member", "cjpm.toml"),
			'[package]\nname = "member_pkg"\nversion = "0.1.0"\n',
			"utf8",
		)
		policy.invalidateProjectCache()

		await expect(
			policy.validateProjectStructureForWrite(
				"member/src/feature/helper.cj",
				"package member_pkg.feature\nclass Helper {}\n",
			),
		).resolves.toBeNull()
		await expect(
			policy.validateProjectStructureForWrite(
				"member/src/feature/helper.cj",
				"package feature\nclass Helper {}\n",
			),
		).resolves.toContain('expected "package member_pkg.feature"')
	})

	it("validates cjpm.toml does not mix package and workspace roots", async () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		await expect(
			policy.validateProjectStructureForWrite(
				"cjpm.toml",
				'[package]\nname = "demo"\n[workspace]\nmembers = []\n',
			),
		).resolves.toContain("[package] and [workspace]")
	})

	it("requires a successful build after Cangjie source changes before completion", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteWriteApplied("src/main.cj", "main() {}", 'main() { println("hi") }')
		expect(policy.getAttemptCompletionBlockReason()).toContain("last successful build")
		expect(policy.getAttemptCompletionBlockReason()).toContain("Run `cjpm build`")
		expect(policy.getAttemptCompletionBlockReason()).toContain("`cjpm check`")
		expect(policy.getAttemptCompletionBlockReason({ allowPendingBuild: true })).toBeNull()

		policy.noteBuildResult("cjpm build", true, "build ok")
		expect(policy.getAttemptCompletionBlockReason()).toBeNull()
		expect(policy.getContextIntensity(2)).toBe("compact")
	})

	it("routes failed delegated verification through repair, verify, and fresh evidence on stagnation", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		policy.configureAgentRoute("新增函数并编译验证")
		policy.noteAgentDelegation("CangjieExplore")
		policy.noteAgentDelegation("CangjieImplement")
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")

		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieRepair" })).toBeNull()
		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieVerify" })).toContain("CangjieRepair")

		policy.noteAgentDelegation("CangjieRepair")
		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieVerify" })).toBeNull()
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")

		expect(policy.getStagnantFailureRounds()).toBe(1)
		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieExplore" })).toBeNull()
		expect(policy.getDelegatedAgentTypes()).toEqual([
			"CangjieExplore",
			"CangjieImplement",
			"CangjieVerify",
			"CangjieRepair",
			"CangjieVerify",
		])
	})

	it("stops delegating after two unsuccessful repair attempts", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		policy.configureAgentRoute("run cjpm build and repair failures")
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")
		policy.noteAgentDelegation("CangjieRepair")
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")
		policy.noteAgentDelegation("CangjieExplore")
		policy.noteAgentDelegation("CangjieRepair")
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")

		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieRepair" })).toContain(
			"repair loop stopped after 2 repair attempts",
		)
		expect(policy.validateAgentStageToolUse("attempt_completion")).toBeNull()
		expect(policy.getAttemptCompletionBlockReason()).toBeNull()
		expect(policy.getRepairDirective()).toBeUndefined()
		expect(policy.getEvalRuntimeSnapshot()).toMatchObject({
			repairAttemptCount: 2,
			repairLoopExhausted: true,
		})
	})

	it("reports a failed verification-only request without starting repair", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		policy.configureAgentRoute("\u53ea\u8fd0\u884c cjpm build \u9a8c\u8bc1\u9879\u76ee\u3002")
		policy.noteAgentDelegation("CangjieVerify")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch\n1 error generated")

		expect(policy.validateAgentStageToolUse("agent", { agentType: "CangjieRepair" })).toContain(
			"verification-only request completed with a failed build",
		)
		expect(policy.validateAgentStageToolUse("attempt_completion")).toBeNull()
		expect(policy.getAttemptCompletionBlockReason()).toBeNull()
		expect(policy.getRepairDirective()).toBeUndefined()
		expect(policy.getEvalRuntimeSnapshot()).toMatchObject({ verificationOnlyRoute: true })
	})

	it("tracks missing stdlib evidence until corpus evidence is recorded", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		const previousContent = "import std.io\nmain() {}\n"
		const nextContent = "import std.io\nimport std.collection\nmain() {}\n"

		expect(policy.getMissingImportEvidence(previousContent, nextContent)).toEqual(["std.collection"])

		policy.noteCorpusSearch(["std.collection"], "std.collection HashMap")
		expect(policy.getMissingImportEvidence(previousContent, nextContent)).toEqual([])
	})

	it("does not treat critical signature hints as external evidence for high-risk stdlib APIs", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(policy.getMissingImportEvidence("", "import std.fs.*\nimport std.regex.*\nmain() {}\n")).toEqual([
			"std.fs",
			"std.regex",
		])

		policy.noteCorpusReadPath("D:/repo/CangjieCorpus-1.0.0/libs/std/fs/fs_package_api/fs_package_classes.md")
		policy.noteCorpusSearch(["std.regex"], "std.regex Regex find matches")

		expect(policy.getMissingImportEvidence("", "import std.fs.*\nimport std.regex.*\nmain() {}\n")).toEqual([])
	})

	it("allows constrained completion text that refuses to assert high-risk API correctness", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getMissingCompletionEvidence(
				"readTextFile uses File.readFrom and String.fromUtf8, but API 正确性无法断言 because the user prohibited corpus and LSP evidence lookup.",
			),
		).toEqual([])
	})

	it("does not require stdlib evidence for a context injection audit that only lists injected groups", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const result = [
			"## Cangjie 上下文注入审计",
			"",
			"本次会话共注入了 11 个 Cangjie 上下文组：",
			"",
			"| 上下文组 | 说明 |",
			"|---|---|",
			"| **toolchain-rules** | 工具链使用规则 |",
			"| **stdlib-signature-hints** | std.fs 关键 API 签名摘要（File.readFrom、Path 等） |",
			"| **import-to-corpus-doc-map** | 当前 import 到 CangjieCorpus 路径的映射 |",
			"| **mandatory-corpus-footer** | 强制语料检索路径 |",
			"",
			"未修改任何文件。",
		].join("\n")

		expect(policy.getMissingCompletionEvidence(result)).toEqual([])
	})

	it("still requires stdlib evidence when a context report asserts API correctness", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const result = [
			"## Cangjie 上下文注入审计",
			"| **stdlib-signature-hints** | std.fs 关键 API 签名摘要（File.readFrom、Path 等） |",
			"",
			"File.readFrom + String.fromUtf8 用法正确。",
		].join("\n")

		expect(policy.getMissingCompletionEvidence(result)).toEqual(["std.fs"])
	})

	it("blocks context injection audits that include extra project status", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const cleanAudit = [
			"## Cangjie context injection audit",
			"",
			"Injected context groups:",
			"- toolchain-rules",
			"- structured-editing-context",
			"- import-to-corpus-doc-map",
			"- visible-editor-symbols",
			"- stdlib-signature-hints",
			"- project-overview",
			"- contextual-coding-rules",
			"- mandatory-corpus-footer",
			"",
			"No files were modified.",
		].join("\n")
		const extraStatusAudit = [
			"## Cangjie context injection audit",
			"",
			"Injected context groups: toolchain-rules, structured-editing-context, import-to-corpus-doc-map, visible-editor-symbols, stdlib-signature-hints, project-overview, contextual-coding-rules, mandatory-corpus-footer.",
			"",
			"**\u9879\u76ee\u72b6\u6001**: web v1.0.0 dynamic, 3 \u6e90\u6587\u4ef6, package structure web/web.client/web.server.",
		].join("\n")

		expect(policy.getContextInjectionAuditScopeReport(cleanAudit)).toBeNull()
		expect(policy.getContextInjectionAuditScopeReport(extraStatusAudit)).toContain(
			"extra project/file/symbol status",
		)
	})

	it("allows context injection audits to state that project/source status was not read", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const result = [
			"## Cangjie context injection audit",
			"",
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
			"",
			"未读取项目状态、未分析源码、未修改文件。",
		].join("\n")

		expect(policy.getContextInjectionAuditScopeReport(result)).toBeNull()
	})

	it("blocks context injection audits that do not list actual labels", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const emptyAudit =
			"Cangjie context injection audit is complete. The report was already submitted. No files were modified."
		const labeledAudit = [
			"## Cangjie context injection audit",
			"- toolchain-rules",
			"- structured-editing-context",
			"- stdlib-signature-hints",
			"No files were modified.",
		].join("\n")

		expect(policy.getContextInjectionAuditMissingLabelsReport(emptyAudit)).toContain("does not list")
		expect(policy.getContextInjectionAuditMissingLabelsReport(labeledAudit)).toBeNull()
	})

	it("does not require external completion evidence after successful Cangjie build verification", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getMissingCompletionEvidence(
				"readTextFile uses File.readFrom(path) and String.fromUtf8(bytes), and the implementation is correct.",
			),
		).toEqual(["std.fs"])

		policy.noteBuildResult("cjpm build", true, "cjpm build success")

		expect(
			policy.getMissingCompletionEvidence(
				"readTextFile uses File.readFrom(path) and String.fromUtf8(bytes), and cjpm build success.",
			),
		).toEqual([])
	})

	it("requires external Option evidence before final reports explain Option defaults", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getMissingCompletionEvidence(
				"Use getOrDefault({ => 0 }) or match with case Some(v) and case None for Option values.",
			),
		).toEqual(["std.core"])

		policy.noteCorpusReadPath(path.join(tempDir, "CangjieCorpus-1.0.0", "extra", "Option.md"))

		expect(
			policy.getMissingCompletionEvidence(
				"Use getOrDefault({ => 0 }) or match with case Some(v) and case None for Option values.",
			),
		).toEqual([])
	})

	it("accepts inline CangjieCorpus manual paths as Option completion evidence", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getMissingCompletionEvidence(
				"Use map.get(w) ?? 0 for Option defaults. Evidence: CangjieCorpus-1.0.0/manual/source_zh_cn/error_handle/use_option.md:48.",
			),
		).toEqual([])
	})

	it("blocks unsupported Byte/UInt8 risk speculation for the official file text pattern", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const contextAuditOnly = [
			"## Cangjie context injection audit",
			"",
			"| # | context group | summary |",
			"|---|---|---|",
			"| 1 | **toolchain-rules** | Cangjie toolchain rules |",
			"| 2 | **structured-editing-context** | current main.cj context |",
			"| 3 | **import-to-corpus-doc-map** | std.fs maps to libs/std/fs |",
			"| 4 | **visible-editor-symbols** | readTextFile and bytes symbols |",
			"| 5 | **stdlib-signature-hints** | std.fs hints mention File.readFrom, String.fromUtf8, Byte and UInt8 |",
			"| 6 | **project-overview** | web project overview |",
			"| 7 | **contextual-coding-rules** | coding rules |",
			"| 8 | **mandatory-corpus-footer** | corpus lookup reminder |",
			"",
			"未修改任何文件。",
		].join("\n")

		expect(policy.getUnsupportedStdlibRiskSpeculation(contextAuditOnly)).toBeNull()

		expect(
			policy.getUnsupportedStdlibRiskSpeculation(
				"File.readFrom returns Array<Byte>. String.fromUtf8 accepts Array<UInt8>. 潜在风险：可能存在类型不匹配，需要确认 Byte 与 UInt8 是否兼容。",
			),
		).toContain("speculates")

		expect(
			policy.getUnsupportedStdlibRiskSpeculation(
				"File.readFrom returns Array<Byte>, and the official file sample passes those bytes to String.fromUtf8.",
			),
		).toBeNull()

		policy.noteBuildResult("cjpm build", true, "cjpm build success")

		expect(
			policy.getUnsupportedStdlibRiskSpeculation(
				"File.readFrom returns Array<Byte>. String.fromUtf8 accepts Array<UInt8>, but cjpm build success confirms the implementation compiles.",
			),
		).toBeNull()
	})

	it("blocks contradictory verification reports that say build success and inconclusive", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getContradictoryVerificationReport(
				"cjpm build success. Verification inconclusive because shell integration failed.",
			),
		).toContain("build succeeded")
		expect(policy.getContradictoryVerificationReport("cjpm build success with one warning.")).toBeNull()
		expect(
			policy.getContradictoryVerificationReport("verification inconclusive because output was unavailable."),
		).toBeNull()
	})

	it("blocks final reports that describe extra probes in explicit command allowlist tasks", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getAllowlistExtraProbeReport(
				"User asked to only run cjpm build. I checked whether cjpm.toml exists to confirm project exists, then ran cjpm build.",
			),
		).toContain("extra project/file probes")
		expect(
			policy.getAllowlistExtraProbeReport("只运行 cjpm build。我先检查当前项目结构，然后执行构建。验证通过。"),
		).toContain("extra project/file probes")
		expect(policy.getAllowlistExtraProbeReport("Only ran cjpm build. cjpm build success.")).toBeNull()
		expect(policy.getAllowlistExtraProbeReport("Checked cjpm.toml as part of normal CangjieExplore.")).toBeNull()
	})

	it("blocks invalid Option.getOrThrow default-value calls in final reports", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(policy.getInvalidOptionDefaultCallReport("Use map.get(word).getOrThrow(0) + 1.")).toContain(
			"default value",
		)
		expect(
			policy.getInvalidOptionDefaultCallReport(
				"Signature evidence: public func getOrThrow(exception: () -> Exception): T",
			),
		).toBeNull()
		expect(
			policy.getInvalidOptionDefaultCallReport(
				"Use opt.getOrThrow({ => MyException() }) when custom exceptions are needed.",
			),
		).toBeNull()
		expect(policy.getInvalidOptionDefaultCallReport("Use opt.getOrThrow() only after Some is proven.")).toBeNull()
	})

	it("blocks HashMap counting plans that use getOrThrow for missing-key defaults", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getUnsafeHashMapCountGetOrThrowReport(
				"HashMap countWords plan: for each word, let count = map.get(w).getOrThrow() + 1; map.add(w, count).",
			),
		).toContain("key may be absent")
		expect(
			policy.getUnsafeHashMapCountGetOrThrowReport(
				"HashMap countWords plan: for each word, let count = (map.get(w) ?? 0) + 1; map.add(w, count).",
			),
		).toBeNull()
	})

	it("blocks incorrect zero-argument Regex.find signatures in final reports", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(policy.getIncorrectRegexFindSignatureReport("public func find(): Option<MatchData>")).toContain(
			"zero-argument",
		)
		expect(
			policy.getIncorrectRegexFindSignatureReport("find(input: String, group!: Bool = false): Option<MatchData>"),
		).toBeNull()
	})

	it("blocks evidence-only final reports that invite immediate coding", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getEvidenceReportInvitationReport(
				"Cangjie evidence audit:\n- corpus read: std.collection\n\nNo files were modified. Tell me if you want implementation.",
			),
		).toContain("invites immediate coding")
		expect(
			policy.getEvidenceReportInvitationReport(
				"Cangjie evidence audit:\n- corpus read: std.collection\n\nEvidence collected; no files were modified.",
			),
		).toBeNull()
		expect(policy.getEvidenceReportInvitationReport("Tell me if you want implementation.")).toBeNull()
	})

	it("blocks HashMap subscript assignment when operator evidence is not cited", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getUncitedHashMapSubscriptAssignmentReport(
				"HashMap countWords evidence: add/get/contains were checked. Implementation uses counts[w] = prev + 1.",
			),
		).toContain("subscript assignment")
		expect(
			policy.getUncitedHashMapSubscriptAssignmentReport(
				"HashMap countWords evidence: operator [](key: K, value!: V): Unit was checked. Implementation uses counts[w] = prev + 1.",
			),
		).toBeNull()
		expect(
			policy.getUncitedHashMapSubscriptAssignmentReport(
				"HashMap countWords evidence: add/get were checked. Implementation uses counts.add(w, prev + 1).",
			),
		).toBeNull()
	})

	it("blocks unsupported HashMap.add mutability claims", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap 是引用类型；let 绑定即可调用 add，因此不需要 var。add 不是 mut 方法。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap add 证据：不能断言 `add` 必须 `var`；推荐 let 而非 var。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap 鏄紩鐢ㄧ被鍨嬶紝add 涓嶆槸 mut 鏂规硶锛宭et 鍗冲彲璋冪敤 add锛屼笉闇€瑕?var銆?",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add requires var because add is a mut method, so let cannot call it.",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"证据: 所有样本代码中，声明 HashMap 时都使用 var。结论: add 必须通过 var 绑定的变量调用。HashMap 变量必须用 var 声明。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"结论: HashMap 的 add、remove、clear、下标赋值等修改操作要求变量绑定为 var。可以断言：add 必须 var。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap add 证据链：结论：可以断言 var 是必需的。add 会修改 HashMap 内部状态，因此必须用 var 绑定。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap add 鏂规硶 mutating銆傜粨璁猴細鍙浠ユ柇瑷€ var 鏄繀闇€鐨勩€俛dd 蹇呴』 var銆?",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap 是 class，let 绑定不可变引用但可以调用其 mut 方法修改内部状态。因此 let map 后调用 map.add(...) 是合法且推荐的写法。不需要 var。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap 本身是引用类型，用 let 绑定即可调用 add/get/contains 等 mut 方法。在计数函数中，如果只需要在函数内部创建 HashMap 并调用 add/get，let 就足够了。但为了清晰和一致性，使用 var 也没有问题。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"手册和示例中全部使用 var 声明 HashMap 变量。结论：可以断言 add 必须 var。因为 HashMap 是引用类型（class），但 add 是 mut 方法（修改内部状态），而 let 绑定的变量不可调用 mut 方法。若用 let 声明，调用 map.add(...) 或 map[key] = value 会导致编译错误。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"内置修复提示也确认：let 绑定的实例不能调用 mut 方法（add 是 mut 方法，会修改 HashMap 内部状态），必须改为 var。关键约束：HashMap 变量必须声明为 var（不能是 let）。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap examples use var as a sample style; do not claim let cannot call add without compiler evidence.",
			),
		).toBeNull()
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add signature: public func add(key: K, value: V): Option<V>. \u7ed3\u8bba: add \u662f mut \u65b9\u6cd5, HashMap \u53d8\u91cf\u5fc5\u987b\u7528 var.",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add signature: public func add(key: K, value: V): Option<V>. \u56e0\u6b64 let map = HashMap<String, Int64>() \u540e\u8c03\u7528 map.add(...) \u662f\u5408\u6cd5\u4e14\u63a8\u8350\u7684\u5199\u6cd5, \u4e0d\u9700\u8981 var.",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add evidence: two binding styles are valid; var is optional for this class.",
			),
		).toContain("remove the entire let/var mutability discussion")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap 是 class 而非 struct，add/get/contains 没有 mut 修饰，let 绑定即可正常调用，无需 var。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add signature: public func add(key: K, value: V): Option<V>. \u4e0d\u80fd\u65ad\u8a00 add \u5fc5\u987b var; use var only as sample style unless compiler evidence says more.",
			),
		).toBeNull()
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add signature: public func add(key: K, value: V): Option<V>. var follows the samples; no let/var semantic conclusion is made here.",
			),
		).toBeNull()
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add signature: public func add(key: K, value: V): Option<V>. var follows the samples; no let/var semantic conclusion is made here. HashMap 是 class，因此 add 不可能是 mut 方法。",
			),
		).toContain("unsupported HashMap.add let/var")
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.add is documented as public func add(key: K, value: V): Option<V>.",
			),
		).toBeNull()
		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"HashMap.get signature is public func get(key: K): ?V. Option 默认值处理推荐使用 getOrDefault({=> 0})、?? 或 match；下标 [] 在键不存在时抛异常。",
			),
		).toBeNull()
	})

	it("does not apply the HashMap mutability gate to ArrayList.add", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"ArrayList<String> uses var result and result.add(value). The report calls add a mut method.",
			),
		).toBeNull()
	})

	it("allows ordinary HashMap implementations that use var without a semantic claim", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		expect(
			policy.getUnsupportedHashMapMutabilityClaimReport(
				"Implemented countWords with var counts = HashMap<String, Int64>() and counts.add(word, next).",
			),
		).toBeNull()
	})

	it("suggests corpus locations when stdlib evidence is missing", () => {
		const policy = new CangjieRuntimePolicy(tempDir)
		const previousContent = "main() {}\n"
		const nextContent = "import std.net\nmain() {}\n"

		policy.noteWriteApplied("src/main.cj", previousContent, nextContent)

		expect(policy.getAttemptCompletionBlockReason()).toContain("missing stdlib evidence for std.net")
		expect(policy.getAttemptCompletionBlockReason()).toContain("CangjieCorpus-1.0.0/libs/std/net")
	})

	it("suggests dedicated extra cards for common stdlib APIs", () => {
		expect(buildStdModuleEvidenceSuggestions("std.collection.ArrayList")).toEqual([
			"CangjieCorpus-1.0.0/libs/std/collection",
			"CangjieCorpus-1.0.0/extra/HashMap.md",
			"CangjieCorpus-1.0.0/extra/ArrayList.md",
		])
		expect(buildStdModuleEvidenceSuggestions("std.fs.File")).toEqual([
			"CangjieCorpus-1.0.0/libs/std/fs",
			"CangjieCorpus-1.0.0/extra/File.md",
		])
		expect(buildStdModuleEvidenceSuggestions("std.regex.Regex")).toEqual([
			"CangjieCorpus-1.0.0/libs/std/regex",
			"CangjieCorpus-1.0.0/extra/Regex.md",
		])
		expect(buildStdModuleEvidenceSuggestions("std.time.DateTime")).toContain("CangjieCorpus-1.0.0/extra/Time.md")
		expect(buildStdModuleEvidenceSuggestions("std.process.executeWithOutput")).toContain(
			"CangjieCorpus-1.0.0/extra/Process.md",
		)
		expect(buildStdModuleEvidenceSuggestions("std.core.Option")).toEqual([
			"CangjieCorpus-1.0.0/libs/std/core",
			"CangjieCorpus-1.0.0/extra/Option.md",
		])
	})

	it("surfaces build root causes and upgrades prompt detail after build failure", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteWriteApplied("src/main.cj", "main() {}", 'main() { let x: Int32 = "oops" }')
		policy.noteBuildResult("cjpm build", true, "build ok")
		policy.noteBuildResult(
			"cjpm build",
			false,
			"type mismatch: expected Int32, found String\n ==> D:\\demo\\src\\main.cj:4:8:",
		)

		expect(policy.getRecentBuildRootCauses()).toContain("类型不匹配")
		expect(policy.getRepairDirective()).toContain("fix only the top root cause")
		expect(policy.getRepairDirective()).toContain("First error: type mismatch")
		expect(policy.getRepairDirective()).toContain("First error location: D:\\demo\\src\\main.cj:4:8")
		expect(policy.getAttemptCompletionBlockReason()).toContain("latest build failed")
		expect(policy.getAttemptCompletionBlockReason()).toContain("First error: type mismatch")
		expect(policy.getAttemptCompletionBlockReason()).toContain("First error location: D:\\demo\\src\\main.cj:4:8")
		expect(policy.getAttemptCompletionBlockReason()).toContain("command: cjpm build")
		expect(policy.getAttemptCompletionBlockReason()).toContain("failure rounds: 1")
		expect(policy.getAttemptCompletionBlockReason()).toContain("stagnant rounds: 0")
		expect(policy.getAttemptCompletionBlockReason({ allowFailedBuildHandoff: true })).toBeNull()
		expect(policy.getContextIntensity(1)).toBe("full")
	})

	it("summarizes cjpm build failures with first error, count, and root causes", () => {
		const inlineTableOutput = [
			`Cannot extend inline table 'package.package-configuration' with sub-title 'package.package-configuration."web.client"'`,
			"Error: parse the '.\\cjpm.toml' file failed",
			"Error: cjpm build failed",
		].join("\n")

		expect(summarizeCangjieBuildFailure(inlineTableOutput)).toMatchObject({
			errorCount: 2,
			firstError: `Cannot extend inline table 'package.package-configuration' with sub-title 'package.package-configuration."web.client"'`,
			rootCauses: ["cjpm-toml-inline-table-error"],
		})

		expect(
			summarizeCangjieBuildFailure("warning: unused import\n\nerror: type mismatch: expected Int32, found String")
				.firstError,
		).toBe("error: type mismatch: expected Int32, found String")

		const locatedOutput = [
			"error: type mismatch: expected Int32, found String",
			"",
			" ==> D:\\cangjie\\demo\\src\\main.cj:7:12:",
			"",
			'7 | let x: Int32 = "oops"',
		].join("\n")

		expect(summarizeCangjieBuildFailure(locatedOutput).firstErrorLocation).toBe(
			"D:\\cangjie\\demo\\src\\main.cj:7:12",
		)
	})

	it("reports stagnant build failure rounds after diagnostics stop improving", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteBuildResult("cjpm build", false, "type mismatch error")
		policy.noteBuildResult("cjpm build", false, "type mismatch error")

		expect(policy.getCompileFailureRounds()).toBe(2)
		expect(policy.getStagnantFailureRounds()).toBe(1)
		expect(policy.getAttemptCompletionBlockReason()).toContain("failure rounds: 2")
		expect(policy.getAttemptCompletionBlockReason()).toContain("stagnant rounds: 1")
		expect(policy.getAttemptCompletionBlockReason()).toContain("diagnostics did not improve")
	})

	it("blocks further Cangjie writes after stagnant repair until fresh evidence is gathered", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteBuildResult("cjpm build", false, "type mismatch error")
		policy.noteBuildResult("cjpm build", false, "type mismatch error")

		expect(policy.getStagnantRepairWriteBlockReason("src/main.cj")).toContain("repair is stagnant")
		expect(policy.getStagnantRepairWriteBlockReason("cjpm.toml")).toContain("diagnostics did not improve")
		expect(policy.getStagnantRepairWriteBlockReason("README.md")).toBeNull()

		policy.noteCorpusSearch(["std.fs"], "File.readFrom")

		expect(policy.getStagnantRepairWriteBlockReason("src/main.cj")).toBeNull()
	})

	it("records LSP evidence in the unified evidence registry", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteLspEvidence("hover", "src/main.cj:3:8", "func println(value: String)")

		expect([...policy.evidenceRecords.keys()]).toContain("lsp_hover:src/main.cj:3:8")
	})

	it("formats an evidence audit summary from corpus and LSP records", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteCorpusSearch(["std.fs"], "File.readFrom String.fromUtf8")
		policy.noteCorpusReadPath(path.join(tempDir, "CangjieCorpus-1.0.0", "libs", "std", "fs", "file_samples.md"))
		policy.noteLspEvidence("hover", "src/main.cj:4:12", "public static func readFrom(path: String)")

		const audit = policy.getEvidenceAuditSummary()

		expect(audit).toContain("Cangjie evidence audit:")
		expect(audit).toContain("corpus search: std.fs")
		expect(audit).toContain("corpus read: std.fs")
		expect(audit).toContain("CangjieCorpus-1.0.0/libs/std/fs/file_samples.md")
		expect(audit).not.toContain(tempDir.replace(/\\/g, "/"))
		expect(audit).toContain("LSP hover: src/main.cj:4:12")
		expect(audit).toContain("File.readFrom")
	})

	it("classifies extra cards and Option manual pages in the evidence audit", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteCorpusReadPath(path.join(tempDir, "CangjieCorpus-1.0.0", "extra", "Option.md"))
		policy.noteCorpusReadPath(
			path.join(tempDir, "CangjieCorpus-1.0.0", "manual", "source_zh_cn", "error_handle", "use_option.md"),
		)

		const audit = policy.getEvidenceAuditSummary()

		expect(audit).toContain("corpus read: std.core")
		expect(audit).toContain("CangjieCorpus-1.0.0/extra/Option.md")
		expect(audit).toContain("CangjieCorpus-1.0.0/manual/source_zh_cn/error_handle/use_option.md")
	})

	it("classifies basic operator manual pages as std.core evidence", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		policy.noteCorpusReadPath(
			path.join(
				tempDir,
				"CangjieCorpus-1.0.0",
				"manual",
				"source_zh_cn",
				"basic_programming_concepts",
				"basic_operators.md",
			),
		)

		expect(
			policy.getMissingCompletionEvidence("Use map.get(word) ?? 0 to default a missing Option<Int64>."),
		).toEqual([])
	})

	it("explains allowed command categories when rejecting unrelated commands", () => {
		const policy = new CangjieRuntimePolicy(tempDir)

		const error = policy.validateCommandSurface("npm test")

		expect(error).toContain('Command rejected in Cangjie mode: "npm test"')
		expect(error).toContain("build/check: cjpm build, cjpm check, cjc")
		expect(error).toContain("read-only investigation")
		expect(error).toContain("where.exe cjpm (cmd)")
		expect(error).toContain("Get-Command cjpm (PowerShell)")
		expect(error).toContain("Cangjie toolchain flow")
	})
})

describe("CangjieRuntimePolicy eval snapshots", () => {
	it("counts successful cjpm init as a project write that requires build validation", () => {
		const policy = new CangjieRuntimePolicy("D:\\workspace")

		policy.noteBuildResult("cjpm init --name bootstrap_demo --type=executable", true, "Project initialized")
		expect(policy.getEvalRuntimeSnapshot()).toMatchObject({
			writeRevision: 1,
			validatedRevision: 0,
			recentBuildSucceeded: false,
			recentBuildFailed: false,
		})
		expect(policy.getAttemptCompletionBlockReason()).toContain("changed after the last successful build")

		policy.noteBuildResult("cjpm build", true, "cjpm build success")
		expect(policy.getEvalRuntimeSnapshot()).toMatchObject({
			writeRevision: 1,
			validatedRevision: 1,
			recentBuildSucceeded: true,
			recentBuildFailed: false,
		})
	})

	it("reports build, failure, and evidence state for eval traces", () => {
		const policy = new CangjieRuntimePolicy("D:\\workspace")
		policy.noteCorpusSearch(["std.fs"], "File.readFrom")
		policy.noteCorpusReadPath("D:\\CangjieCorpus-1.0.0\\libs\\std\\fs\\file.md")
		policy.noteBuildResult("cjpm build", false, "error: type mismatch")

		expect(policy.getEvalRuntimeSnapshot()).toMatchObject({
			writeRevision: 0,
			validatedRevision: 0,
			recentBuildSucceeded: false,
			recentBuildFailed: true,
			compileFailureRounds: 1,
			stagnantFailureRounds: 0,
			searchedStdModules: ["std.fs"],
			corpusReadModules: ["std.fs"],
			corpusReadPathCount: 1,
			pendingEvidenceModules: [],
			evidenceRecordCount: 2,
			recentBuildCommand: "cjpm build",
		})
	})
})

describe("isAllowedCangjieCommand", () => {
	it("allows toolchain and read-only helper commands", () => {
		expect(isAllowedCangjieCommand("cjpm build")).toBe(true)
		expect(isAllowedCangjieCommand("cjpm build 2>&1")).toBe(true)
		expect(isAllowedCangjieCommand("cjfmt -f main.cj")).toBe(true)
		expect(isAllowedCangjieCommand("Get-Content src/main.cj")).toBe(true)
		expect(isAllowedCangjieCommand("where cjpm")).toBe(true)
		expect(isAllowedCangjieCommand("where.exe cjpm")).toBe(true)
		expect(isAllowedCangjieCommand("Get-Command cjpm")).toBe(true)
	})

	it("blocks Windows cmd directory-switch wrappers before Cangjie commands", () => {
		expect(isAllowedCangjieCommand("cd /d d:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build")).toBe(false)
		expect(isAllowedCangjieCommand("d: && cd d:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build")).toBe(false)
	})

	it("blocks PowerShell wrappers around Cangjie commands", () => {
		expect(
			isAllowedCangjieCommand('powershell -Command "cd d:\\cangjie\\Cangjie-Examples\\HTTP; cjpm build"'),
		).toBe(false)
		expect(
			isAllowedCangjieCommand(
				'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location d:\\cangjie\\Cangjie-Examples\\HTTP; cjpm check"',
			),
		).toBe(false)
	})

	it("blocks unrelated commands", () => {
		expect(isAllowedCangjieCommand("npm test")).toBe(false)
		expect(isAllowedCangjieCommand("python script.py")).toBe(false)
		expect(isAllowedCangjieCommand("cd /d d:\\cangjie\\Cangjie-Examples\\HTTP && npm test")).toBe(false)
		expect(isAllowedCangjieCommand("dir d:\\cangjie & npm test")).toBe(false)
		expect(isAllowedCangjieCommand('powershell -Command "cd d:\\cangjie\\Cangjie-Examples\\HTTP; npm test"')).toBe(
			false,
		)
	})
})
