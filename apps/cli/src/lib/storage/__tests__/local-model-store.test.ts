import fs from "fs/promises"
import path from "path"
import os from "os"

import { vi } from "vitest"

import {
	loadModelStore,
	saveModelStore,
	pushRecent,
	toggleFavorite,
	cycleRecent,
	cycleFavorite,
	getVariant,
	setVariant,
	resolveInitialModel,
	parseModelString,
	PROVIDER_DEFAULT_MODEL,
	__TEST_ONLY__,
} from "../local-model-store.js"

const { RECENT_LIMIT } = __TEST_ONLY__

let tempDir: string

function getTempModelPath(): string {
	return path.join(tempDir, "model.json")
}

// Monkey-patch getStateDir so tests write to a temp directory.
vi.mock("../state-dir.js", () => ({
	getStateDir: () => tempDir,
	ensureStateDir: async () => {
		await fs.mkdir(tempDir, { recursive: true })
	},
}))

beforeEach(async () => {
	tempDir = path.join(os.tmpdir(), `njust-ai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	await fs.mkdir(tempDir, { recursive: true })
})

afterEach(async () => {
	try {
		await fs.rm(tempDir, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

describe("loadModelStore", () => {
	it("returns empty data when file is missing", async () => {
		const data = await loadModelStore()
		expect(data).toEqual({ recent: [], favorite: [], variant: {} })
	})

	it("returns parsed data when file exists", async () => {
		const payload = {
			recent: [{ providerID: "openai", modelID: "gpt-4o" }],
			favorite: [{ providerID: "anthropic", modelID: "claude-sonnet-4-5" }],
			variant: { "openai/gpt-4o": "thinking" },
		}
		await fs.writeFile(getTempModelPath(), JSON.stringify(payload), "utf-8")
		const data = await loadModelStore()
		expect(data.recent).toEqual(payload.recent)
		expect(data.favorite).toEqual(payload.favorite)
		expect(data.variant).toEqual(payload.variant)
	})

	it("returns empty data on invalid JSON", async () => {
		await fs.writeFile(getTempModelPath(), "not json", "utf-8")
		const data = await loadModelStore()
		expect(data).toEqual({ recent: [], favorite: [], variant: {} })
	})

	it("ignores malformed entries in arrays", async () => {
		const payload = {
			recent: [{ providerID: "openai", modelID: "gpt-4o" }, { foo: "bar" }],
			favorite: [null, { providerID: "anthropic", modelID: "claude-sonnet-4-5" }],
			variant: {},
		}
		await fs.writeFile(getTempModelPath(), JSON.stringify(payload), "utf-8")
		const data = await loadModelStore()
		expect(data.recent).toEqual([{ providerID: "openai", modelID: "gpt-4o" }])
		expect(data.favorite).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-4-5" }])
	})
})

describe("saveModelStore", () => {
	it("writes atomically and creates missing directories", async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
		await saveModelStore({
			recent: [{ providerID: "openai", modelID: "gpt-4o" }],
			favorite: [],
			variant: {},
		})
		const raw = await fs.readFile(getTempModelPath(), "utf-8")
		const parsed = JSON.parse(raw)
		expect(parsed.recent).toEqual([{ providerID: "openai", modelID: "gpt-4o" }])
	})

	it("overwrites existing file", async () => {
		await fs.writeFile(getTempModelPath(), JSON.stringify({ recent: [], favorite: [], variant: {} }), "utf-8")
		await saveModelStore({
			recent: [{ providerID: "anthropic", modelID: "claude-sonnet-4-5" }],
			favorite: [],
			variant: {},
		})
		const raw = await fs.readFile(getTempModelPath(), "utf-8")
		const parsed = JSON.parse(raw)
		expect(parsed.recent).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-4-5" }])
	})
})

describe("pushRecent", () => {
	it("prepends new model and dedupes", () => {
		const r = pushRecent(
			[
				{ providerID: "openai", modelID: "gpt-4o" },
				{ providerID: "anthropic", modelID: "claude-sonnet-4-5" },
			],
			{ providerID: "anthropic", modelID: "claude-sonnet-4-5" },
		)
		expect(r).toEqual([
			{ providerID: "anthropic", modelID: "claude-sonnet-4-5" },
			{ providerID: "openai", modelID: "gpt-4o" },
		])
	})

	it("caps at RECENT_LIMIT (10)", () => {
		const recent = Array.from({ length: 15 }, (_, i) => ({
			providerID: "p",
			modelID: `m${i}`,
		}))
		const r = pushRecent(recent, { providerID: "p", modelID: "new" })
		expect(r.length).toBe(RECENT_LIMIT)
		expect(r[0]).toEqual({ providerID: "p", modelID: "new" })
	})
})

describe("toggleFavorite", () => {
	it("adds model when not present", () => {
		const f = toggleFavorite([], { providerID: "openai", modelID: "gpt-4o" })
		expect(f).toEqual([{ providerID: "openai", modelID: "gpt-4o" }])
	})

	it("removes model when present", () => {
		const f = toggleFavorite([{ providerID: "openai", modelID: "gpt-4o" }], {
			providerID: "openai",
			modelID: "gpt-4o",
		})
		expect(f).toEqual([])
	})
})

describe("cycleRecent", () => {
	it("cycles forward", () => {
		const recent = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
			{ providerID: "c", modelID: "3" },
		]
		expect(cycleRecent(recent, { providerID: "a", modelID: "1" }, 1)).toEqual({
			providerID: "b",
			modelID: "2",
		})
	})

	it("wraps around forward", () => {
		const recent = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
		]
		expect(cycleRecent(recent, { providerID: "b", modelID: "2" }, 1)).toEqual({ providerID: "a", modelID: "1" })
	})

	it("cycles backward", () => {
		const recent = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
			{ providerID: "c", modelID: "3" },
		]
		expect(cycleRecent(recent, { providerID: "b", modelID: "2" }, -1)).toEqual({ providerID: "a", modelID: "1" })
	})

	it("returns undefined when current is not in list", () => {
		expect(cycleRecent([{ providerID: "a", modelID: "1" }], { providerID: "x", modelID: "x" }, 1)).toBeUndefined()
	})
})

describe("cycleFavorite", () => {
	it("picks first when current not in favorites (direction=1)", () => {
		const favorite = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
		]
		expect(cycleFavorite(favorite, { providerID: "x", modelID: "x" }, 1)).toEqual({ providerID: "a", modelID: "1" })
	})

	it("picks last when current not in favorites (direction=-1)", () => {
		const favorite = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
		]
		expect(cycleFavorite(favorite, { providerID: "x", modelID: "x" }, -1)).toEqual({
			providerID: "b",
			modelID: "2",
		})
	})

	it("cycles within favorites", () => {
		const favorite = [
			{ providerID: "a", modelID: "1" },
			{ providerID: "b", modelID: "2" },
		]
		expect(cycleFavorite(favorite, { providerID: "a", modelID: "1" }, 1)).toEqual({ providerID: "b", modelID: "2" })
		expect(cycleFavorite(favorite, { providerID: "b", modelID: "2" }, 1)).toEqual({ providerID: "a", modelID: "1" })
	})
})

describe("variant", () => {
	it("getVariant returns stored value", () => {
		const variants = { "openai/gpt-4o": "thinking" }
		expect(getVariant(variants, { providerID: "openai", modelID: "gpt-4o" })).toBe("thinking")
	})

	it("setVariant stores value", () => {
		const variants = {}
		const next = setVariant(variants, { providerID: "openai", modelID: "gpt-4o" }, "thinking")
		expect(next["openai/gpt-4o"]).toBe("thinking")
	})

	it("setVariant writes 'default' sentinel for undefined", () => {
		const variants = {}
		const next = setVariant(variants, { providerID: "openai", modelID: "gpt-4o" }, undefined)
		expect(next["openai/gpt-4o"]).toBe("default")
	})
})

describe("resolveInitialModel", () => {
	it("prefers cliFlag", () => {
		const result = resolveInitialModel({
			cliFlag: { providerID: "cli", modelID: "model" },
			settingsModel: { providerID: "settings", modelID: "model" },
			recent: [{ providerID: "recent", modelID: "model" }],
			providerDefault: { providerID: "default", modelID: "model" },
		})
		expect(result).toEqual({ providerID: "cli", modelID: "model" })
	})

	it("falls back to settingsModel", () => {
		const result = resolveInitialModel({
			cliFlag: undefined,
			settingsModel: { providerID: "settings", modelID: "model" },
			recent: [{ providerID: "recent", modelID: "model" }],
			providerDefault: { providerID: "default", modelID: "model" },
		})
		expect(result).toEqual({ providerID: "settings", modelID: "model" })
	})

	it("falls back to recent[0]", () => {
		const result = resolveInitialModel({
			cliFlag: undefined,
			settingsModel: undefined,
			recent: [{ providerID: "recent", modelID: "model" }],
			providerDefault: { providerID: "default", modelID: "model" },
		})
		expect(result).toEqual({ providerID: "recent", modelID: "model" })
	})

	it("falls back to providerDefault", () => {
		const result = resolveInitialModel({
			cliFlag: undefined,
			settingsModel: undefined,
			recent: [],
			providerDefault: { providerID: "default", modelID: "model" },
		})
		expect(result).toEqual({ providerID: "default", modelID: "model" })
	})

	it("returns undefined when all empty", () => {
		expect(resolveInitialModel({ cliFlag: undefined, settingsModel: undefined, recent: [], providerDefault: undefined })).toBeUndefined()
	})
})

describe("parseModelString", () => {
	it("parses provider/model", () => {
		expect(parseModelString("openai/gpt-4o")).toEqual({ providerID: "openai", modelID: "gpt-4o" })
	})

	it("handles model IDs with slashes", () => {
		expect(parseModelString("openrouter/anthropic/claude-sonnet-4-5")).toEqual({
			providerID: "openrouter",
			modelID: "anthropic/claude-sonnet-4-5",
		})
	})

	it("returns undefined for missing slash", () => {
		expect(parseModelString("gpt-4o")).toBeUndefined()
	})

	it("returns undefined for empty string", () => {
		expect(parseModelString("")).toBeUndefined()
	})
})

describe("PROVIDER_DEFAULT_MODEL", () => {
	it("contains expected providers", () => {
		expect(PROVIDER_DEFAULT_MODEL["njust-ai"]).toBeDefined()
		expect(PROVIDER_DEFAULT_MODEL["anthropic"]).toBeDefined()
		expect(PROVIDER_DEFAULT_MODEL["openai"]).toBeDefined()
	})
})
