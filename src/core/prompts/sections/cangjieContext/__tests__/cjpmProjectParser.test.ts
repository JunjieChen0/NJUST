import { describe, it, expect, vi } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

vi.mock("../cangjie-context", () => ({
	getCangjiePromptServices: vi.fn(() => ({
		getCangjieSymbolIndex: vi.fn(() => null),
	})),
}))
vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))
vi.mock("../../../../shared/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { buildProjectPackageValidationSection, parseCjpmTomlContent } = await import("../cjpmProjectParser")

const cwd = "/fake/project"

describe("parseCjpmTomlContent", () => {
	it("parses single-module project", async () => {
		const content = ["[package]", 'name = "hello"', 'version = "0.1.0"'].join(String.fromCharCode(10))
		const result = await parseCjpmTomlContent(content, cwd)
		expect(result).not.toBeNull()
		expect(result.name).toBe("hello")
	})

	it("returns null for invalid content", async () => {
		const result = await parseCjpmTomlContent("not valid", cwd)
		expect(result).toBeNull()
	})

	it("reports the expected package declaration from the source layout", async () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cangjie-project-structure-"))
		try {
			const nestedDir = path.join(projectDir, "src", "foo")
			fs.mkdirSync(nestedDir, { recursive: true })
			fs.writeFileSync(path.join(nestedDir, "bar.cj"), "package wrong\n", "utf8")

			const result = await buildProjectPackageValidationSection(projectDir, {
				name: "web",
				version: "1.0.0",
				outputType: "dynamic",
				isWorkspace: false,
				srcDir: "src",
			})

			expect(result).toContain("Package declaration validation: issues found")
			expect(result).toContain("src/foo/bar.cj")
			expect(result).toContain("package wrong")
			expect(result).toContain("package web.foo")
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true })
		}
	})

	it("reports successful package validation for workspace members", async () => {
		const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cangjie-workspace-structure-"))
		try {
			const memberDir = path.join(projectDir, "member-a", "src")
			fs.mkdirSync(memberDir, { recursive: true })
			fs.writeFileSync(path.join(memberDir, "main.cj"), "package alpha\n", "utf8")

			const result = await buildProjectPackageValidationSection(projectDir, {
				name: "",
				version: "",
				outputType: "",
				isWorkspace: true,
				srcDir: "src",
				members: [{ name: "alpha", path: "member-a", outputType: "executable" }],
			})

			expect(result).toBe("Package declaration validation: OK")
		} finally {
			fs.rmSync(projectDir, { recursive: true, force: true })
		}
	})
})
