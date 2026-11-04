import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { TestOptions } from "@vscode/test-electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	runTests: vi.fn<(options: TestOptions) => Promise<number>>(),
	startMockServer: vi.fn(),
	close: vi.fn(),
}))

vi.mock("@vscode/test-electron", () => ({ runTests: mocks.runTests }))
vi.mock("../../packages/mock-api-server/src/runtime.js", () => ({ startMockServer: mocks.startMockServer }))
vi.mock("fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof fs>()),
	mkdtemp: vi.fn(),
	rm: vi.fn(),
}))

describe("Extension Host test profile isolation", () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
		mocks.runTests.mockResolvedValue(0)
		mocks.close.mockResolvedValue(undefined)
		mocks.startMockServer.mockResolvedValue({ url: "http://127.0.0.1:12345", close: mocks.close })
		vi.mocked(fs.mkdtemp).mockImplementation(async (prefix) => `${prefix}fixture`)
		vi.mocked(fs.rm).mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	it.each([false, true])("keeps profile data outside the workspace (installed VS Code=%s)", async (installed) => {
		vi.stubEnv("VSCODE_EXECUTABLE_PATH", installed ? "/test/code" : undefined)
		await import("../../apps/vscode-e2e/src/runTest")
		await vi.waitFor(() => expect(mocks.runTests).toHaveBeenCalledOnce())
		await vi.waitFor(() => expect(fs.rm).toHaveBeenCalledOnce())
		const options = mocks.runTests.mock.calls[0]![0]
		const userData = options.launchArgs?.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1]
		const extensions = options.launchArgs?.find((arg) => arg.startsWith("--extensions-dir="))?.split("=")[1]
		expect(userData).toBeDefined()
		expect(extensions).toBeDefined()
		const expectedPrefix = path.join(os.tmpdir(), "njust-ai-test-profile-")
		expect(userData!.startsWith(expectedPrefix)).toBe(true)
		expect(extensions!.startsWith(expectedPrefix)).toBe(true)
		expect(path.dirname(userData!)).toBe(path.dirname(extensions!))
		expect(fs.rm).not.toHaveBeenCalledWith(path.dirname(userData!), expect.anything())
	})
})
