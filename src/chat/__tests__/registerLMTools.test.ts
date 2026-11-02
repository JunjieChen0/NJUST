import * as vscode from "vscode"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { registerLMTools } from "../registerLMTools"
import { asMock } from "../../__tests__/helpers/asMock"

const ignoredPaths = new Set<string>()

vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError: vi.fn() } }))
vi.mock("../../utils/pathUtils", () => ({ isPathOutsideWorkspace: vi.fn().mockReturnValue(false) }))
vi.mock("../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		constructor(private cwd: string) {}
		async initialize() {}
		validateAccess(filePath: string) {
			const normalized = filePath.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")
			const rel = normalized.startsWith(this.cwd + "/") ? normalized.slice(this.cwd.length + 1) : normalized
			return !ignoredPaths.has(rel)
		}
		dispose() {}
	},
}))

const fileContents: Record<string, string> = {
	"secret.env": "API_KEY=hunter2",
	"src/app.ts": "const API_KEY = process.env.API_KEY",
}

vi.mock("vscode", () => {
	const registered = new Map<string, unknown>()
	const toRel = (p: string) =>
		p
			.replace(/\\/g, "/")
			.replace(/^[A-Za-z]:/, "")
			.replace(/^\/ws\//, "")
	return {
		__registered: registered,
		lm: {
			registerTool: vi.fn((name: string, tool: unknown) => {
				registered.set(name, tool)
				return { dispose() {} }
			}),
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: "/ws" } }],
			fs: {
				readFile: vi.fn(async (uri: { fsPath: string }) => {
					const content = fileContents[toRel(uri.fsPath)]
					if (content === undefined) throw new Error("not found")
					return new TextEncoder().encode(content)
				}),
			},
			findFiles: vi.fn(async () => Object.keys(fileContents).map((rel) => ({ fsPath: `/ws/${rel}` }))),
			asRelativePath: vi.fn((uri: { fsPath: string }) => toRel(uri.fsPath)),
		},
		Uri: { file: (p: string) => ({ fsPath: p }) },
		RelativePattern: class {
			constructor(
				public base: string,
				public pattern: string,
			) {}
		},
		LanguageModelTextPart: class {
			constructor(public value: string) {}
		},
		LanguageModelToolResult: class {
			constructor(public content: Array<{ value: string }>) {}
		},
	}
})

type Tool = {
	invoke: (
		options: { input: Record<string, unknown> },
		token: unknown,
	) => Promise<{ content: Array<{ value: string }> }>
}

async function invoke(name: string, input: Record<string, unknown>): Promise<string> {
	const tool = asMock<{ __registered: Map<string, Tool> }>(vscode).__registered.get(name)!
	const result = await tool.invoke({ input }, {})
	return result.content.map((c) => c.value).join("")
}

describe("registerLMTools — ignore rules", () => {
	beforeAll(() => {
		registerLMTools(
			asMock<vscode.ExtensionContext>({ subscriptions: [] }),
			{} as never,
			asMock<vscode.OutputChannel>({ appendLine: vi.fn() }),
		)
	})

	beforeEach(() => {
		ignoredPaths.clear()
		ignoredPaths.add("secret.env")
	})

	it("refuses to read an ignored file", async () => {
		const out = await invoke("njust_ai_readFile", { path: "secret.env" })
		expect(out).not.toContain("hunter2")
		expect(out).toMatch(/ignore/i)
	})

	it("still reads a non-ignored file", async () => {
		const out = await invoke("njust_ai_readFile", { path: "src/app.ts" })
		expect(out).toContain("process.env.API_KEY")
	})

	it("excludes ignored files from search results", async () => {
		const out = await invoke("njust_ai_searchFiles", { pattern: "API_KEY" })
		expect(out).toContain("src/app.ts")
		expect(out).not.toContain("secret.env")
		expect(out).not.toContain("hunter2")
	})

	it("excludes ignored files from listings", async () => {
		const out = await invoke("njust_ai_listFiles", { path: ".", recursive: true })
		expect(out).toContain("src/app.ts")
		expect(out).not.toContain("secret.env")
	})
})
