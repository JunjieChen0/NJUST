import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { setGuardedFetchProxy } from "@njust-ai/core/security"
import { createMockExtensionContext } from "../../__tests__/helpers/vscodeMocks"

vi.mock("@njust-ai/core/security", () => ({ setGuardedFetchProxy: vi.fn() }))
vi.mock("vscode", () => ({
	workspace: { getConfiguration: vi.fn(), onDidChangeConfiguration: vi.fn() },
	ExtensionMode: { Development: 2, Production: 1, Test: 3 },
}))
vi.mock("global-agent", () => ({ bootstrap: vi.fn() }))
vi.mock("undici", () => ({
	ProxyAgent: class {},
	setGlobalDispatcher: vi.fn(),
	fetch: vi.fn(),
}))

describe("development proxy for guarded requests", () => {
	let enabled: boolean
	let serverUrl: string
	let tlsInsecure: boolean
	let changed: (event: vscode.ConfigurationChangeEvent) => void
	let context: vscode.ExtensionContext
	const originalFetch = globalThis.fetch
	const originalEnv = new Map(
		["GLOBAL_AGENT_HTTP_PROXY", "GLOBAL_AGENT_HTTPS_PROXY", "GLOBAL_AGENT_NO_PROXY"].map((key) => [
			key,
			process.env[key],
		]),
	)

	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
		enabled = true
		serverUrl = "http://127.0.0.1:8888"
		tlsInsecure = false
		context = createMockExtensionContext({ extensionMode: vscode.ExtensionMode.Development, subscriptions: [] })
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: (key: string) =>
				({
					"debugProxy.enabled": enabled,
					"debugProxy.serverUrl": serverUrl,
					"debugProxy.tlsInsecure": tlsInsecure,
				})[key],
		} as vscode.WorkspaceConfiguration)
		vi.spyOn(vscode.workspace, "onDidChangeConfiguration").mockImplementation((listener) => {
			changed = listener
			return { dispose: vi.fn() }
		})
	})

	afterEach(() => {
		for (const subscription of context.subscriptions) subscription.dispose()
		globalThis.fetch = originalFetch
		for (const [key, value] of originalEnv) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
		vi.restoreAllMocks()
	})

	it("sets guarded routing before requests and clears it on disable and disposal", async () => {
		const { initializeNetworkProxy } = await import("../networkProxy")
		await initializeNetworkProxy(context)
		expect(setGuardedFetchProxy).toHaveBeenLastCalledWith({ serverUrl, tlsInsecure: false })
		serverUrl = "http://127.0.0.1:9999"
		tlsInsecure = true
		changed({ affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent)
		expect(setGuardedFetchProxy).toHaveBeenLastCalledWith({ serverUrl, tlsInsecure: true })
		enabled = false
		changed({ affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent)
		expect(setGuardedFetchProxy).toHaveBeenLastCalledWith(undefined)
		enabled = true
		changed({ affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent)
		expect(setGuardedFetchProxy).toHaveBeenLastCalledWith({ serverUrl, tlsInsecure: true })
		for (const subscription of context.subscriptions) subscription.dispose()
		expect(setGuardedFetchProxy).toHaveBeenLastCalledWith(undefined)
	})

	it("does not enable guarded proxy routing in production", async () => {
		context = createMockExtensionContext({ extensionMode: vscode.ExtensionMode.Production, subscriptions: [] })
		const { initializeNetworkProxy } = await import("../networkProxy")
		await initializeNetworkProxy(context)
		expect(setGuardedFetchProxy).not.toHaveBeenCalled()
	})
})
