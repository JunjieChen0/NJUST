import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"

const {
	mockShowInputBox,
	mockShowInformationMessage,
	mockShowErrorMessage,
	mockApplyEdit,
	mockGetWorkspaceFolder,
	mockFindFiles,
	mockOpenTextDocument,
	mockShowTextDocument,
	mockReadFileSync,
	mockWriteFileSync,
	mockExistsSync,
	mockMkdirSync,
	mockUnlinkSync,
	mockRealpathSync,
	mockOpenSync,
	mockWriteSync,
	mockCloseSync,
	mockParseDefinitions,
} = vi.hoisted(() => ({
	mockShowInputBox: vi.fn(),
	mockShowInformationMessage: vi.fn(),
	mockShowErrorMessage: vi.fn(),
	mockApplyEdit: vi.fn(),
	mockGetWorkspaceFolder: vi.fn(),
	mockFindFiles: vi.fn(),
	mockOpenTextDocument: vi.fn(),
	mockShowTextDocument: vi.fn(),
	mockReadFileSync: vi.fn().mockReturnValue(""),
	mockWriteFileSync: vi.fn(),
	mockExistsSync: vi.fn().mockReturnValue(true),
	mockMkdirSync: vi.fn(),
	mockUnlinkSync: vi.fn(),
	mockRealpathSync: Object.assign(vi.fn(), { native: undefined }) as any,
	mockOpenSync: vi.fn(),
	mockWriteSync: vi.fn(),
	mockCloseSync: vi.fn(),
	mockParseDefinitions: vi.fn().mockReturnValue([]),
}))

vi.mock("vscode", () => ({
	CodeAction: class {
		constructor(
			public title: string,
			public kind: unknown,
		) {}
	},
	CodeActionKind: {
		RefactorExtract: { value: "refactor.extract" },
		Refactor: { value: "refactor" },
	},
	window: {
		showInputBox: mockShowInputBox,
		showInformationMessage: mockShowInformationMessage,
		showErrorMessage: mockShowErrorMessage,
		showTextDocument: mockShowTextDocument,
		activeTextEditor: undefined,
	},
	workspace: {
		applyEdit: mockApplyEdit,
		getWorkspaceFolder: mockGetWorkspaceFolder,
		findFiles: mockFindFiles,
		openTextDocument: mockOpenTextDocument,
	},
	WorkspaceEdit: class {
		replace = vi.fn()
		insert = vi.fn()
		delete = vi.fn()
		get size() {
			return this.replace.mock.calls.length + this.insert.mock.calls.length + this.delete.mock.calls.length
		}
	},
	Range: class {
		public start: any
		public end: any
		constructor(startLine: any, startChar: any, endLine?: any, endChar?: any) {
			if (endLine !== undefined) {
				this.start = { line: startLine, character: startChar }
				this.end = { line: endLine, character: endChar }
			} else {
				this.start = startLine
				this.end = startChar
			}
		}
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Selection: class {
		constructor(
			public anchor: unknown,
			public active: unknown,
		) {}
	},
	Uri: { file: (p: string) => ({ fsPath: p }) },
}))

vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		default: {
			...actual,
			readFileSync: mockReadFileSync,
			writeFileSync: mockWriteFileSync,
			existsSync: mockExistsSync,
			mkdirSync: mockMkdirSync,
			unlinkSync: mockUnlinkSync,
			realpathSync: mockRealpathSync,
			openSync: mockOpenSync,
			writeSync: mockWriteSync,
			closeSync: mockCloseSync,
		},
		readFileSync: mockReadFileSync,
		writeFileSync: mockWriteFileSync,
		existsSync: mockExistsSync,
		mkdirSync: mockMkdirSync,
		unlinkSync: mockUnlinkSync,
		realpathSync: mockRealpathSync,
		openSync: mockOpenSync,
		writeSync: mockWriteSync,
		closeSync: mockCloseSync,
	}
})

vi.mock("../tree-sitter/cangjieParser", () => ({
	parseCangjieDefinitions: mockParseDefinitions,
}))

vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
}))

import { CangjieRefactoringProvider } from "../CangjieRefactoringProvider"

describe("CangjieRefactoringProvider", () => {
	let provider: CangjieRefactoringProvider
	let mockIndex: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockIndex = { findDefinitions: vi.fn().mockReturnValue([]) }
		provider = new CangjieRefactoringProvider(mockIndex)

		// Default: realpathSync returns the input unchanged (no symlinks).
		mockRealpathSync.mockImplementation((p: string) => p)
		// Default: openSync returns a fake fd.
		mockOpenSync.mockReturnValue(42)
		mockWriteSync.mockReturnValue(undefined)
		mockCloseSync.mockReturnValue(undefined)
	})

	describe("provideCodeActions", () => {
		it("returns empty array when range is empty", () => {
			const doc = { getText: () => "", uri: {} } as any
			const range = { isEmpty: true } as any
			const result = provider.provideCodeActions(doc, range, { diagnostics: [] } as any, {} as any)
			expect(result).toEqual([])
		})

		it("returns extract action when range is not empty", () => {
			const doc = { getText: () => "let x = 1", uri: {} } as any
			const range = { isEmpty: false, start: { line: 0, character: 0 }, end: { line: 0, character: 9 } } as any
			const result = provider.provideCodeActions(doc, range, { diagnostics: [] } as any, {} as any)
			expect(result.length).toBe(1)
			expect(result[0].title).toContain("Extract")
		})
	})

	describe("dispose", () => {
		it("does not throw", () => {
			expect(() => provider.dispose()).not.toThrow()
		})
	})

	describe("extractFunction", () => {
		beforeEach(() => {
			mockParseDefinitions.mockReset()
			mockParseDefinitions.mockReturnValue([])
			mockApplyEdit.mockResolvedValue(undefined)
		})

		it("returns early when selected text is empty", async () => {
			const doc = {
				getText: () => "",
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } as any

			await provider.extractFunction(doc, range)

			expect(mockShowInputBox).not.toHaveBeenCalled()
			expect(mockApplyEdit).not.toHaveBeenCalled()
		})

		it("returns early when selected text is whitespace only", async () => {
			const doc = {
				getText: () => "   \n  \t  ",
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 5 } } as any

			await provider.extractFunction(doc, range)

			expect(mockShowInputBox).not.toHaveBeenCalled()
		})

		it("returns early when user cancels function name input", async () => {
			const doc = {
				getText: (_r: any) => "some code",
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } } as any
			mockShowInputBox.mockResolvedValueOnce(undefined)

			await provider.extractFunction(doc, range)

			expect(mockShowInputBox).toHaveBeenCalled()
			expect(mockApplyEdit).not.toHaveBeenCalled()
		})

		it("extracts successfully without free variables", async () => {
			const fullText = "func main(): Unit {\n\tprint(42)\n}"
			const doc = {
				getText: (r?: any) => (r ? "print(42)" : fullText),
				lineAt: () => ({ text: "\tprint(42)" }),
				lineCount: 3,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 1, character: 1 }, end: { line: 1, character: 10 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			expect(mockApplyEdit).toHaveBeenCalledTimes(1)
			const edit = mockApplyEdit.mock.calls[0][0]
			const calls = edit.replace.mock.calls
			expect(calls.length).toBe(1)
			expect(calls[0][2]).toBe("\textracted()")

			const insertCalls = edit.insert.mock.calls
			expect(insertCalls.length).toBe(1)
			expect(insertCalls[0][1]).toEqual({ line: 3, character: 0 })
			expect(insertCalls[0][2]).toContain("func extracted()")
			expect(insertCalls[0][2]).toContain("print(42)")
		})

		it("extracts with free variables detected in context", async () => {
			const doc = {
				getText: (r?: any) => {
					if (!r) return "let x: Int = 1\nlet z = x + 1\n"
					if (r.start && r.start.line === 0 && r.end && r.end.line === 1) {
						return "let x: Int = 1\n"
					}
					return "print(x)"
				},
				lineAt: () => ({ text: "print(x)" }),
				lineCount: 2,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			expect(mockApplyEdit).toHaveBeenCalledTimes(1)
			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.replace.mock.calls[0][2]).toBe("extracted(x)")
			expect(edit.insert.mock.calls[0][2]).toContain("extracted(x: Int ")
		})

		it("extracts with enclosing class using enclosing endLine", async () => {
			const doc = {
				getText: (r?: any) => {
					if (!r) return "class Foo {\n\tfunc bar(): Unit {\n\t\tsomeCode()\n\t}\n}"
					return "someCode()"
				},
				lineAt: () => ({ text: "\t\tsomeCode()" }),
				lineCount: 5,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 2, character: 2 }, end: { line: 2, character: 12 } } as any
			mockShowInputBox.mockResolvedValueOnce("helper")
			mockParseDefinitions.mockReturnValue([{ kind: "class", name: "Foo", startLine: 0, endLine: 4 }])

			await provider.extractFunction(doc, range)

			expect(mockApplyEdit).toHaveBeenCalledTimes(1)
			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.insert.mock.calls[0][1]).toEqual({ line: 4, character: 0 })
			expect(edit.insert.mock.calls[0][2]).toContain("func helper()")
		})

		it("uses range.end.line + 2 when no enclosing type exists", async () => {
			const doc = {
				getText: (r?: any) => (r ? "someCode()" : "someCode()\n\n\n\n"),
				lineAt: () => ({ text: "someCode()" }),
				lineCount: 10,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.insert.mock.calls[0][1]).toEqual({ line: 5, character: 0 })
		})

		it("clamps insertion line to document lineCount", async () => {
			const doc = {
				getText: (r?: any) => (r ? "someCode()" : "short"),
				lineAt: () => ({ text: "someCode()" }),
				lineCount: 5,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 3, character: 0 }, end: { line: 4, character: 10 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([{ kind: "struct", name: "S", startLine: 0, endLine: 20 }])

			await provider.extractFunction(doc, range)

			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.insert.mock.calls[0][1]).toEqual({ line: 5, character: 0 })
		})

		it("filters out keywords from free variable candidates", async () => {
			const doc = {
				getText: (r?: any) => {
					if (!r) return "let x: Int = 1\nif (true) { return x }\n"
					if (r.start && r.start.line === 0 && r.end && r.end.line === 1) {
						return "let x: Int = 1\n"
					}
					return "if (true) { return x }"
				},
				lineAt: () => ({ text: "if (true) { return x }" }),
				lineCount: 2,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 22 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			expect(mockApplyEdit).toHaveBeenCalledTimes(1)
			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.replace.mock.calls[0][2]).toBe("extracted(x)")
			expect(edit.insert.mock.calls[0][2]).toContain("extracted(x: Int ")
		})

		it("handles unknown identifiers with no matching declarations", async () => {
			const doc = {
				getText: (r?: any) => {
					if (!r) return "let x: Int = 1\nlet z = unknownFunc(x)\n"
					if (r.start && r.start.line === 0 && r.end && r.end.line === 1) {
						return "let x: Int = 1\n"
					}
					return "unknownFunc(x)"
				},
				lineAt: () => ({ text: "unknownFunc(x)" }),
				lineCount: 2,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 1, character: 8 }, end: { line: 1, character: 22 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			expect(mockApplyEdit).toHaveBeenCalledTimes(1)
			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.replace.mock.calls[0][2]).toBe("extracted(x)")
			expect(edit.insert.mock.calls[0][2]).toContain("extracted(x: Int ")
		})

		it("infers /* infer */ type when declaration has no type annotation", async () => {
			const doc = {
				getText: (r?: any) => {
					if (!r) return "let x = 42\nprint(x)\n"
					if (r.start && r.start.line === 0 && r.end && r.end.line === 1) {
						return "let x = 42\n"
					}
					return "print(x)"
				},
				lineAt: () => ({ text: "print(x)" }),
				lineCount: 2,
				uri: { fsPath: "/test.cj" },
			} as any
			const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } } as any
			mockShowInputBox.mockResolvedValueOnce("extracted")
			mockParseDefinitions.mockReturnValue([])

			await provider.extractFunction(doc, range)

			const edit = mockApplyEdit.mock.calls[0][0]
			expect(edit.insert.mock.calls[0][2]).toContain("func extracted(x: /* infer */)")
		})
	})

	describe("moveFile", () => {
		beforeEach(() => {
			mockApplyEdit.mockResolvedValue(undefined)
			mockShowTextDocument.mockResolvedValue(undefined)
			mockFindFiles.mockResolvedValue([])
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })
			// Default: realpathSync returns the input unchanged (no symlinks).
			mockRealpathSync.mockImplementation((p: string) => p)
			mockOpenSync.mockReturnValue(42)
			mockWriteSync.mockReturnValue(undefined)
			mockCloseSync.mockReturnValue(undefined)
		})

		it("returns early when no workspace folder", async () => {
			mockGetWorkspaceFolder.mockReturnValue(null)

			await provider.moveFile({ fsPath: "/project/src/A.cj" })

			expect(mockShowInputBox).not.toHaveBeenCalled()
		})

		it("returns early when user cancels input", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/project" },
			})
			mockShowInputBox.mockResolvedValueOnce(undefined)

			await provider.moveFile({ fsPath: "/project/src/A.cj" })

			expect(mockShowInputBox).toHaveBeenCalled()
			expect(mockOpenSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("returns early when target path is same as source", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/project" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/A.cj")

			await provider.moveFile({ fsPath: "/project/src/A.cj" })

			expect(mockOpenSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("creates target directory when it does not exist", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/newDir/A.cj")
			mockExistsSync.mockReturnValue(false)
			mockReadFileSync.mockReturnValue("package foo\ncontent")

			await provider.moveFile({ fsPath: "/workspace/src/oldDir/A.cj" })

			expect(mockMkdirSync).toHaveBeenCalled()
			expect(mockOpenSync).toHaveBeenCalled()
			expect(mockWriteSync).toHaveBeenCalled()
			expect(mockCloseSync).toHaveBeenCalled()
			expect(mockUnlinkSync).toHaveBeenCalled()
		})

		it("does not create directory when it already exists", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/existingDir/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("content")

			await provider.moveFile({ fsPath: "/workspace/src/oldDir/A.cj" })

			expect(mockMkdirSync).not.toHaveBeenCalled()
			expect(mockOpenSync).toHaveBeenCalled()
		})

		it("moves file and updates package declaration", async () => {
			const workspaceRoot = "/workspace"
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: workspaceRoot },
			})
			mockShowInputBox.mockResolvedValueOnce("src/bar/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package foo.bar\n\nclass A {}")
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			// Verify writeSync was called with updated package
			expect(mockWriteSync).toHaveBeenCalled()
			const writtenContent = mockWriteSync.mock.calls[0][1]
			expect(writtenContent).toContain("package bar")
			expect(writtenContent).not.toContain("package foo.bar")

			expect(mockUnlinkSync).toHaveBeenCalled()
			expect(mockOpenTextDocument).toHaveBeenCalled()
			expect(mockShowTextDocument).toHaveBeenCalled()
		})

		it("moves file without package change in same directory", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/pkg/B.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package pkg\n\nclass A {}")
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })

			await provider.moveFile({ fsPath: "/workspace/src/pkg/A.cj" })

			expect(mockWriteSync).toHaveBeenCalled()
			const writtenContent = mockWriteSync.mock.calls[0][1]
			expect(writtenContent).toBe("package pkg\n\nclass A {}")

			expect(mockUnlinkSync).toHaveBeenCalled()
			expect(mockOpenTextDocument).toHaveBeenCalled()
			expect(mockShowTextDocument).toHaveBeenCalled()
		})

		it("moves file from src root to subdirectory without package update", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/pkg/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("class A {}")
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })

			await provider.moveFile({ fsPath: "/workspace/src/A.cj" })

			expect(mockWriteSync).toHaveBeenCalled()
			const writtenContent = mockWriteSync.mock.calls[0][1]
			expect(writtenContent).toBe("class A {}")

			expect(mockUnlinkSync).toHaveBeenCalled()
			expect(mockApplyEdit).not.toHaveBeenCalled()
		})

		it("moves file to src root without package update", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package foo\n\nclass A {}")
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			expect(mockWriteSync).toHaveBeenCalled()
			const writtenContent = mockWriteSync.mock.calls[0][1]
			expect(writtenContent).toBe("package foo\n\nclass A {}")

			expect(mockUnlinkSync).toHaveBeenCalled()
			expect(mockApplyEdit).not.toHaveBeenCalled()
		})

		// ── Security regression tests ────────────────────────────

		it("rejects path traversal via '..' segments", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("../outside/A.cj")

			await provider.moveFile({ fsPath: "/workspace/src/A.cj" })

			// realpathSync on the escaped path resolves outside the workspace.
			expect(mockShowErrorMessage).toHaveBeenCalled()
			expect(mockOpenSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("rejects path where target parent is a symlink outside workspace", async () => {
			const wsRoot = "/workspace"
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: wsRoot },
			})
			mockShowInputBox.mockResolvedValueOnce("linked_dir/A.cj")

			// Simulate: workspace root is normal, but "linked_dir" is a
			// symlink to /etc (outside workspace). On Windows path.resolve
			// prepends the drive letter, so match by basename.
			const resolvedWs = path.resolve(wsRoot)
			const resolvedLinkedDir = path.resolve(wsRoot, "linked_dir")
			mockRealpathSync.mockImplementation((p: string) => {
				if (p === resolvedWs) return path.resolve("/real/workspace")
				if (p === resolvedLinkedDir) return path.resolve("/etc")
				return p
			})

			await provider.moveFile({ fsPath: path.join(wsRoot, "src", "A.cj") })

			expect(mockShowErrorMessage).toHaveBeenCalled()
			expect(mockOpenSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("allows path where non-existent target is logically within workspace", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("subdir/new_target/file.cj")
			mockExistsSync.mockReturnValue(false)
			mockReadFileSync.mockReturnValue("content")

			// Simulate: /workspace is real, /workspace/subdir is real,
			// but /workspace/subdir/new_target doesn't exist yet.
			mockRealpathSync.mockImplementation((p: string) => {
				if (p === "/workspace") return "/real/workspace"
				if (p === "/workspace/subdir") return "/real/workspace/subdir"
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
			})

			await provider.moveFile({ fsPath: "/workspace/src/A.cj" })

			expect(mockOpenSync).toHaveBeenCalled()
		})

		it("rejects path where symlink in existing parent chain redirects outside workspace", async () => {
			const wsRoot = "/workspace"
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: wsRoot },
			})
			mockShowInputBox.mockResolvedValueOnce("harmless/sub/file.cj")
			mockExistsSync.mockReturnValue(false)

			// "harmless" is actually a symlink to /tmp (outside workspace).
			const resolvedWs = path.resolve(wsRoot)
			const resolvedHarmless = path.resolve(wsRoot, "harmless")
			mockRealpathSync.mockImplementation((p: string) => {
				if (p === resolvedWs) return path.resolve("/real/workspace")
				if (p === resolvedHarmless) return path.resolve("/tmp")
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
			})

			await provider.moveFile({ fsPath: path.join(wsRoot, "src", "A.cj") })

			expect(mockShowErrorMessage).toHaveBeenCalled()
			expect(mockOpenSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("rejects write when openSync fails with EEXIST (existing file or symlink)", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/bar/B.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("content")

			// openSync with 'wx' flag fails because target already exists / is symlink
			mockOpenSync.mockImplementation(() => {
				throw Object.assign(new Error("file exists"), { code: "EEXIST" })
			})

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			expect(mockShowErrorMessage).toHaveBeenCalled()
			expect(mockWriteSync).not.toHaveBeenCalled()
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})
	})

	describe("updateImportReferences (via moveFile)", () => {
		let editCallCount: number

		beforeEach(() => {
			editCallCount = 0
			mockApplyEdit.mockResolvedValue(undefined)
			mockShowTextDocument.mockResolvedValue(undefined)
			mockFindFiles.mockResolvedValue([])
			mockOpenTextDocument.mockResolvedValue({ getText: () => "" })
			mockRealpathSync.mockImplementation((p: string) => p)
			mockOpenSync.mockReturnValue(42)
			mockWriteSync.mockReturnValue(undefined)
			mockCloseSync.mockReturnValue(undefined)
		})

		it("updates import references across workspace", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/bar/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package foo\n\nclass A {}")

			mockFindFiles.mockResolvedValue([{ fsPath: "/workspace/src/other/B.cj" }])
			mockOpenTextDocument.mockResolvedValue({
				getText: () => "import foo.*\n\nclass B {}",
			})

			mockApplyEdit.mockImplementation(async () => {
				editCallCount++
			})

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			expect(editCallCount).toBe(1)
			expect(mockFindFiles).toHaveBeenCalledWith("**/*.cj", "**/target/**", 500)
		})

		it("skips unreadable files gracefully", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/bar/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package foo\n\nclass A {}")

			mockFindFiles.mockResolvedValue([
				{ fsPath: "/workspace/src/other/B.cj" },
				{ fsPath: "/workspace/src/other/C.cj" },
			])
			mockOpenTextDocument
				.mockResolvedValueOnce({ getText: () => "import foo.*" })
				.mockRejectedValueOnce(new Error("Cannot read file"))
				.mockResolvedValue({ getText: () => "" })

			mockApplyEdit.mockImplementation(async () => {
				editCallCount++
			})

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			expect(editCallCount).toBe(1)
			expect(mockOpenTextDocument).toHaveBeenCalledTimes(3)
		})

		it("skips files that do not contain the old package name", async () => {
			mockGetWorkspaceFolder.mockReturnValue({
				uri: { fsPath: "/workspace" },
			})
			mockShowInputBox.mockResolvedValueOnce("src/bar/A.cj")
			mockExistsSync.mockReturnValue(true)
			mockReadFileSync.mockReturnValue("package foo\n\nclass A {}")

			mockFindFiles.mockResolvedValue([{ fsPath: "/workspace/src/other/B.cj" }])
			mockOpenTextDocument
				.mockResolvedValueOnce({ getText: () => "class B {}" })
				.mockResolvedValue({ getText: () => "" })

			mockApplyEdit.mockImplementation(async () => {
				editCallCount++
			})

			await provider.moveFile({ fsPath: "/workspace/src/foo/A.cj" })

			expect(editCallCount).toBe(0)
		})
	})
})
