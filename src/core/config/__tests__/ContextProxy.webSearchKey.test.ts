import { afterEach, describe, expect, it, vi } from "vitest"
import type { ExtensionContext } from "vscode"
import { GLOBAL_STATE_KEYS, isSecretStateKey } from "@njust-ai/types"
import { ContextProxy } from "../ContextProxy"

const proxies: ContextProxy[] = []
afterEach(() => {
	for (const proxy of proxies.splice(0)) proxy.dispose()
})

function fixture(legacyKey?: string, storedKey?: string) {
	const globals = new Map<string, unknown>([["webSearchApiKey", legacyKey]])
	const secrets = new Map<string, string | undefined>([["webSearchApiKey", storedKey]])
	const context = {
		globalState: {
			get: vi.fn((key: string) => globals.get(key)),
			update: vi.fn(async (key: string, value: unknown) => {
				globals.set(key, value)
			}),
		},
		secrets: {
			get: vi.fn(async (key: string) => secrets.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				secrets.set(key, value)
			}),
		},
	} as unknown as ExtensionContext
	const create = async () => {
		const proxy = new ContextProxy(context)
		proxies.push(proxy)
		await proxy.initialize()
		return proxy
	}
	return { globals, secrets, context, create }
}

describe("web search credential storage", () => {
	it("classifies the search key as a secret instead of ordinary global state", () => {
		expect(isSecretStateKey("webSearchApiKey")).toBe(true)
		expect(GLOBAL_STATE_KEYS).not.toContain("webSearchApiKey")
	})

	it("migrates a legacy key before clearing its ordinary configuration value", async () => {
		const f = fixture("legacy-key")
		const proxy = await f.create()
		expect(f.secrets.get("webSearchApiKey")).toBe("legacy-key")
		expect(f.globals.get("webSearchApiKey")).toBeUndefined()
		expect(proxy.getValue("webSearchApiKey")).toBe("legacy-key")
		const store = vi.mocked(f.context.secrets.store)
		const update = vi.mocked(f.context.globalState.update)
		expect(store.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]!)
	})

	it("keeps a newer secret rather than overwriting it with the legacy value", async () => {
		const f = fixture("legacy-key", "rotated-key")
		const proxy = await f.create()
		expect(proxy.getValue("webSearchApiKey")).toBe("rotated-key")
		expect(f.context.secrets.store).not.toHaveBeenCalled()
		expect(f.globals.get("webSearchApiKey")).toBeUndefined()
	})

	it("preserves the legacy key on a failed write and retries migration on restart", async () => {
		const f = fixture("legacy-key")
		vi.mocked(f.context.secrets.store).mockRejectedValueOnce(new Error("Secret storage unavailable"))
		await f.create()
		expect(f.globals.get("webSearchApiKey")).toBe("legacy-key")
		expect(f.secrets.get("webSearchApiKey")).toBeUndefined()
		const restored = await f.create()
		expect(restored.getValue("webSearchApiKey")).toBe("legacy-key")
		expect(f.globals.get("webSearchApiKey")).toBeUndefined()
	})

	it("does not overwrite an unreadable secret with a stale legacy key", async () => {
		const f = fixture("legacy-key", "rotated-key")
		vi.mocked(f.context.secrets.get).mockRejectedValue(new Error("Keyring locked"))
		await f.create()
		expect(f.context.secrets.store).not.toHaveBeenCalled()
		expect(f.globals.get("webSearchApiKey")).toBe("legacy-key")
		expect(f.secrets.get("webSearchApiKey")).toBe("rotated-key")
	})

	it("refreshes the key cache if a transient secret read recovers during migration", async () => {
		const f = fixture("legacy-key", "rotated-key")
		let searchKeyReads = 0
		vi.mocked(f.context.secrets.get).mockImplementation(async (key) => {
			if (key === "webSearchApiKey" && searchKeyReads++ === 0) throw new Error("Temporary keyring failure")
			return f.secrets.get(key)
		})
		const proxy = await f.create()
		expect(proxy.getValue("webSearchApiKey")).toBe("rotated-key")
		expect(f.context.secrets.store).not.toHaveBeenCalled()
	})
})
