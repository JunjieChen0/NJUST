/**
 * Local model store — port of OpenCode's `local.tsx` model state logic
 * (see `opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx`).
 *
 * Persists `recent` / `favorite` / `variant` to a JSON file in the
 * platform-specific state directory:
 *
 *   Linux:   $XDG_STATE_HOME/njust-ai/model.json   (default ~/.local/state/njust-ai/model.json)
 *   macOS:   ~/Library/Application Support/NJUST-AI/state/model.json
 *   Windows: %LOCALAPPDATA%\NJUST-AI\state\model.json
 *
 * Schema is identical to OpenCode's:
 *
 *   {
 *     "recent":   [{"providerID","modelID"}, ... up to 10],
 *     "favorite": [{"providerID","modelID"}, ...],
 *     "variant":  { "<providerID>/<modelID>": "<variantName>" }
 *   }
 *
 * Selection priority on launch (mirrors `fallbackModel()` in OpenCode):
 *   1. CLI flag `--model providerID/modelID`
 *   2. settings file `model` field
 *   3. `recent[0]` from model.json
 *   4. provider-specific fallback table (PROVIDER_DEFAULT_MODEL)
 *
 * Recent list is a deduped FIFO capped at 10 entries; favorite is an
 * ordered list with toggle-on / toggle-off semantics.
 */

import fs from "fs/promises"
import path from "path"

import { ensureStateDir, getStateDir } from "./state-dir.js"

export interface ModelRef {
	providerID: string
	modelID: string
}

export interface ModelStoreData {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

/** Sensible default model id for each provider. Mirrors ConnectDialog. */
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
	anthropic: "claude-sonnet-4-5",
	"njust-ai": "anthropic/claude-sonnet-4.5",
	openai: "gpt-4o",
	"openai-native": "o3",
	openrouter: "anthropic/claude-sonnet-4.5",
	"vercel-ai-gateway": "anthropic/claude-sonnet-4.5",
	gemini: "gemini-2.5-pro",
	deepseek: "deepseek-chat",
	moonshot: "moonshot-v1-auto",
	minimax: "MiniMax-M1",
	mistral: "mistral-large-latest",
	qwen: "qwen-max",
	doubao: "doubao-1-5-pro-32k",
	glm: "glm-4.6",
	mimo: "mimo-m1-80k",
	"mimo-token-plan": "mimo-m1-80k",
	xai: "grok-4",
	zai: "glm-4.6",
	fireworks: "accounts/fireworks/models/llama-v3p3-70b-instruct",
	sambanova: "Llama-3.3-70B-Instruct",
	baseten: "deepseek-ai/DeepSeek-V3",
	requesty: "anthropic/claude-sonnet-4.5",
	litellm: "gpt-4o",
	unbound: "openai/gpt-4o",
}

/** OpenCode `providers.ts:368` priority — lower number = higher in list. */
export const PROVIDER_PRIORITY: Record<string, number> = {
	"njust-ai": 0,
	"openai-native": 1,
	openai: 1,
	gemini: 3,
	anthropic: 4,
	openrouter: 5,
	"vercel-ai-gateway": 6,
}

/** Friendly labels (id → display). Falls back to the raw id. */
export const PROVIDER_LABELS: Record<string, string> = {
	openrouter: "OpenRouter",
	"njust-ai": "NJUST_AI Cloud",
	"vercel-ai-gateway": "Vercel AI Gateway",
	anthropic: "Anthropic",
	"openai-native": "OpenAI",
	openai: "OpenAI-compatible",
	gemini: "Google Gemini",
	deepseek: "DeepSeek",
	moonshot: "Moonshot",
	minimax: "MiniMax",
	mistral: "Mistral",
	qwen: "Alibaba Qwen",
	glm: "Zhipu GLM",
	xai: "xAI Grok",
	zai: "Z.AI",
	doubao: "Volcengine Doubao",
	mimo: "MiMo",
	"mimo-token-plan": "MiMo Token Plan",
	sambanova: "SambaNova",
	baseten: "Baseten",
	fireworks: "Fireworks",
	ollama: "Ollama (local)",
	requesty: "Requesty",
	litellm: "LiteLLM",
	unbound: "Unbound",
}

/** Available models per provider (hardcoded popular models). Mirrors the
 *  model catalog that OpenCode fetches from `models.dev/api.json`. Each
 *  provider gets its most capable general-purpose models listed. */
export const PROVIDER_MODELS: Record<string, string[]> = {
	anthropic: ["claude-sonnet-4-5", "claude-opus-4", "claude-haiku-4"],
	"njust-ai": ["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "google/gemini-2.5-pro"],
	openai: ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini"],
	"openai-native": ["o3", "gpt-4o", "gpt-4o-mini"],
	openrouter: [
		"anthropic/claude-sonnet-4.5",
		"anthropic/claude-opus-4",
		"openai/gpt-4o",
		"google/gemini-2.5-pro",
		"deepseek/deepseek-chat",
	],
	"vercel-ai-gateway": ["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "google/gemini-2.5-pro"],
	gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-pro"],
	deepseek: ["deepseek-chat", "deepseek-reasoner"],
	moonshot: ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k"],
	minimax: ["MiniMax-M1", "MiniMax-Text-01"],
	mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
	qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
	doubao: ["doubao-1-5-pro-32k", "doubao-1-5-lite-32k"],
	glm: ["glm-4.6", "glm-4.5", "glm-4-air"],
	mimo: ["mimo-m1-80k", "mimo-m1-256k"],
	"mimo-token-plan": ["mimo-m1-80k", "mimo-m1-256k"],
	xai: ["grok-4", "grok-3", "grok-3-mini"],
	zai: ["glm-4.6", "glm-4.5"],
	fireworks: [
		"accounts/fireworks/models/llama-v3p3-70b-instruct",
		"accounts/fireworks/models/llama-v3p1-405b-instruct",
	],
	sambanova: ["Llama-3.3-70B-Instruct", "Llama-3.1-405B-Instruct"],
	baseten: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"],
	requesty: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
	litellm: ["gpt-4o", "claude-sonnet-4-5"],
	unbound: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5"],
	ollama: ["llama3.3", "qwen2.5", "deepseek-coder-v2"],
}

const RECENT_LIMIT = 10
const MODEL_FILE = "model.json"

function emptyData(): ModelStoreData {
	return { recent: [], favorite: [], variant: {} }
}

function modelFilePath(): string {
	return path.join(getStateDir(), MODEL_FILE)
}

function refKey(ref: ModelRef): string {
	return `${ref.providerID}/${ref.modelID}`
}

function refEquals(a: ModelRef, b: ModelRef): boolean {
	return a.providerID === b.providerID && a.modelID === b.modelID
}

/**
 * Dedupe by `providerID/modelID`, preserving first occurrence order.
 * Mirrors OpenCode's `uniqueBy([model, ...recent], (x) => providerID/modelID)`.
 */
function uniqueBy(items: ModelRef[]): ModelRef[] {
	const seen = new Set<string>()
	const out: ModelRef[] = []
	for (const item of items) {
		const k = refKey(item)
		if (seen.has(k)) continue
		seen.add(k)
		out.push({ providerID: item.providerID, modelID: item.modelID })
	}
	return out
}

/**
 * Read `model.json` from disk. Missing file or parse errors yield empty
 * data — never throw — so a corrupted state file can't block launch.
 */
export async function loadModelStore(): Promise<ModelStoreData> {
	try {
		const raw = await fs.readFile(modelFilePath(), "utf-8")
		const parsed = JSON.parse(raw) as Partial<ModelStoreData>
		const out = emptyData()
		if (Array.isArray(parsed.recent)) {
			out.recent = parsed.recent.filter(isValidRef).map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
		}
		if (Array.isArray(parsed.favorite)) {
			out.favorite = parsed.favorite
				.filter(isValidRef)
				.map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
		}
		if (parsed.variant && typeof parsed.variant === "object") {
			for (const [k, v] of Object.entries(parsed.variant)) {
				if (typeof k === "string" && (typeof v === "string" || v === undefined)) {
					out.variant[k] = v
				}
			}
		}
		return out
	} catch {
		return emptyData()
	}
}

function isValidRef(r: unknown): r is ModelRef {
	return (
		typeof r === "object" &&
		r !== null &&
		typeof (r as Record<string, unknown>).providerID === "string" &&
		typeof (r as Record<string, unknown>).modelID === "string"
	)
}

/**
 * Persist model store atomically to disk. Auto-creates the state
 * directory. Errors are logged via the caller (we don't want a save
 * failure to break the running TUI).
 */
export async function saveModelStore(data: ModelStoreData): Promise<void> {
	await ensureStateDir()
	const tmp = modelFilePath() + ".tmp"
	const payload = JSON.stringify(
		{
			recent: data.recent,
			favorite: data.favorite,
			variant: data.variant,
		},
		null,
		2,
	)
	await fs.writeFile(tmp, payload, { mode: 0o600 })
	await fs.rename(tmp, modelFilePath())
}

/**
 * Append `model` to the recent list:
 *   - newest entry first
 *   - dedupe by providerID/modelID
 *   - truncate to RECENT_LIMIT (10)
 *
 * Returns a NEW array; does not mutate the input.
 */
export function pushRecent(recent: ModelRef[], model: ModelRef): ModelRef[] {
	const merged = uniqueBy([model, ...recent])
	if (merged.length > RECENT_LIMIT) merged.length = RECENT_LIMIT
	return merged
}

/**
 * Toggle favorite: add if absent, remove if present. New favorites are
 * prepended (newest first), matching OpenCode's `[model, ...favorite]`.
 */
export function toggleFavorite(favorite: ModelRef[], model: ModelRef): ModelRef[] {
	const exists = favorite.some((x) => refEquals(x, model))
	if (exists) return favorite.filter((x) => !refEquals(x, model))
	return [model, ...favorite].map((x) => ({ providerID: x.providerID, modelID: x.modelID }))
}

/**
 * Find the next model when cycling through `recent` from the current one.
 * Returns undefined if the current model isn't in the list. Direction is
 * +1 (next) or -1 (previous), wrapping around. Mirrors `cycle()` from
 * OpenCode local.tsx lines 241–255.
 */
export function cycleRecent(
	recent: ModelRef[],
	current: ModelRef | undefined,
	direction: 1 | -1,
): ModelRef | undefined {
	if (!current || recent.length === 0) return undefined
	const idx = recent.findIndex((x) => refEquals(x, current))
	if (idx === -1) return undefined
	let next = idx + direction
	if (next < 0) next = recent.length - 1
	if (next >= recent.length) next = 0
	return recent[next]
}

/**
 * Cycle through `favorite` only. When the current model isn't a
 * favorite, picks the first (direction=1) or last (direction=-1) entry.
 * Mirrors `cycleFavorite()` from OpenCode local.tsx lines 256–290.
 */
export function cycleFavorite(
	favorite: ModelRef[],
	current: ModelRef | undefined,
	direction: 1 | -1,
): ModelRef | undefined {
	if (favorite.length === 0) return undefined
	let idx = -1
	if (current) idx = favorite.findIndex((x) => refEquals(x, current))
	if (idx === -1) {
		return direction === 1 ? favorite[0] : favorite[favorite.length - 1]
	}
	idx += direction
	if (idx < 0) idx = favorite.length - 1
	if (idx >= favorite.length) idx = 0
	return favorite[idx]
}

/**
 * Look up a per-model variant (e.g. "thinking" / "default"). Mirrors
 * `variant.selected()` / `variant.set()` keying scheme.
 */
export function getVariant(variants: Record<string, string | undefined>, model: ModelRef): string | undefined {
	return variants[refKey(model)]
}

export function setVariant(
	variants: Record<string, string | undefined>,
	model: ModelRef,
	value: string | undefined,
): Record<string, string | undefined> {
	// OpenCode writes literal "default" when undefined is passed (line 363
	// of local.tsx); the getter then masks it because "default" is never
	// in `list()`. We follow the same convention.
	return { ...variants, [refKey(model)]: value ?? "default" }
}

/**
 * Selection priority chain mirroring OpenCode `fallbackModel()`:
 *   1. CLI flag (`--model providerID/modelID`) → `cliFlag`
 *   2. settings file (`provider`+`model` fields) → `settingsModel`
 *   3. recent[0] from model.json
 *   4. provider-specific default table → `providerDefault`
 *
 * Returns the first non-undefined match. Caller decides what "valid"
 * means (we don't have provider/model registry data here, so we trust
 * the first non-empty ref).
 */
export function resolveInitialModel(opts: {
	cliFlag?: ModelRef
	settingsModel?: ModelRef
	recent: ModelRef[]
	providerDefault?: ModelRef
}): ModelRef | undefined {
	if (opts.cliFlag) return opts.cliFlag
	if (opts.settingsModel) return opts.settingsModel
	if (opts.recent.length > 0) return opts.recent[0]
	if (opts.providerDefault) return opts.providerDefault
	return undefined
}

/**
 * Parse `providerID/modelID` strings — OpenCode's `parseModel()` from
 * local.tsx lines 18–24. The model id may itself contain slashes (e.g.
 * `anthropic/claude-sonnet-4-5` via openrouter), so we keep the first
 * segment as the provider and join the rest as the model.
 */
export function parseModelString(value: string): ModelRef | undefined {
	const trimmed = value.trim()
	if (!trimmed.includes("/")) return undefined
	const [providerID, ...rest] = trimmed.split("/")
	const modelID = rest.join("/")
	if (!providerID || !modelID) return undefined
	return { providerID, modelID }
}

export const __TEST_ONLY__ = { uniqueBy, refKey, refEquals, RECENT_LIMIT }
