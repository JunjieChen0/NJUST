/**
 * `<ConnectDialog>` — provider connect flow (`/connect`).
 *
 * Mirrors OpenCode's `auth login` UX (see `opencode/packages/opencode/src/cli/cmd/providers.ts`):
 *
 *   1. Provider list, sorted by OpenCode's hard-coded priority
 *      (opencode → openai → google → anthropic → openrouter → vercel → others)
 *      with hints baked in (e.g. "recommended", "ChatGPT Plus/Pro or API key").
 *   2. Optional pre-prompt info message shown via `DialogAlert` for providers
 *      that have a known sign-up page (opencode, anthropic, openrouter, …).
 *   3. Masked API-key input (`Prompt.password` equivalent) with the exact
 *      OpenCode prompt text "Enter your API key".
 *
 * On submit we persist `{ provider, apiKeysByProvider: { [provider]: key } }`
 * to `cli-settings.json` (mode 0o600) AND inject the key into
 * `process.env[<envVarName>]` for the current session.
 */

import { useState } from "react"

import { providerNames } from "@njust-ai/types"
import type { ProviderName, WebviewMessage } from "@njust-ai/types"

import { saveSettings } from "@/lib/storage/settings.js"
import {
	PROVIDER_DEFAULT_MODEL,
	PROVIDER_LABELS,
	PROVIDER_PRIORITY,
	pushRecent,
	saveModelStore,
} from "@/lib/storage/local-model-store.js"
import { getEnvVarName, getProviderSettings } from "@/lib/utils/provider.js"

import { DialogAlert } from "../dialog/DialogAlert.js"
import { DialogPrompt } from "../dialog/DialogPrompt.js"
import { DialogSelect } from "../dialog/DialogSelect.js"
import type { DialogSelectOption } from "../dialog/DialogSelect.js"
import { useDialog } from "../dialog/DialogProvider.js"

const PROVIDERS_WITHOUT_API_KEY = new Set<string>([
	"bedrock",
	"vertex",
	"vscode-lm",
	"openai-codex",
	"gemini-cli",
	"qwen-code",
	"fake-ai",
	"lmstudio",
])

/** Inline hints shown next to the provider title in the picker. */
const PROVIDER_HINTS: Record<string, string> = {
	"njust-ai": "recommended",
	"openai-native": "ChatGPT Plus/Pro or API key",
}

/**
 * Pre-prompt info text shown via DialogAlert before the API-key step.
 * Mirrors OpenCode's per-provider info messages (providers.ts:453–476).
 */
const PROVIDER_PREAMBLE: Record<string, string> = {
	"njust-ai": "Create an API key in your NJUST_AI Cloud dashboard.",
	anthropic: "Create an API key at https://console.anthropic.com/settings/keys",
	openrouter: "Create an API key at https://openrouter.ai/keys",
	"openai-native": "Create an API key at https://platform.openai.com/api-keys",
	openai: "Use any OpenAI-compatible endpoint. Configure base URL via cli-settings.json or your provider's docs.",
	gemini: "Create an API key at https://aistudio.google.com/app/apikey",
	"vercel-ai-gateway": "Create an API key at https://vercel.link/ai-gateway-token",
	deepseek: "Create an API key at https://platform.deepseek.com/api_keys",
	moonshot: "Create an API key at https://platform.moonshot.cn/console/api-keys",
	mistral: "Create an API key at https://console.mistral.ai/api-keys",
	qwen: "Create an API key at https://dashscope.console.aliyun.com/apiKey",
	glm: "Create an API key at https://open.bigmodel.cn/usercenter/apikeys",
	xai: "Create an API key at https://console.x.ai",
	zai: "Create an API key at https://platform.z.ai",
	doubao: "Create an API key at https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
	fireworks: "Create an API key at https://fireworks.ai/account/api-keys",
	sambanova: "Create an API key at https://cloud.sambanova.ai/apis",
	baseten: "Create an API key at https://app.baseten.co/settings/api_keys",
}

function buildProviderOptions(): DialogSelectOption<ProviderName>[] {
	const eligible = providerNames.filter((p) => !PROVIDERS_WITHOUT_API_KEY.has(p))
	const sorted = [...eligible].sort((a, b) => {
		const pa = PROVIDER_PRIORITY[a] ?? 99
		const pb = PROVIDER_PRIORITY[b] ?? 99
		if (pa !== pb) return pa - pb
		// Stable secondary sort: friendly label, falls back to id.
		const la = PROVIDER_LABELS[a] ?? a
		const lb = PROVIDER_LABELS[b] ?? b
		return la.localeCompare(lb)
	})
	return sorted.map((p) => {
		const label = PROVIDER_LABELS[p] ?? p
		const hint = PROVIDER_HINTS[p]
		return {
			value: p as ProviderName,
			title: hint ? `${label}  ${hint}` : label,
		}
	})
}

export interface ConnectDialogProps {
	/** Called after a successful connect — typically shows a toast. */
	onSuccess?: (provider: ProviderName) => void
	/** Called when the user dismisses the flow. */
	onCancel?: () => void
	/**
	 * Optional bridge to forward connect updates to the running extension
	 * host. When provided, the dialog sends `upsertApiConfiguration` +
	 * `loadApiConfiguration` so the live task picks up the new key without
	 * requiring a restart. Without this, the key is still persisted to
	 * `cli-settings.json` and injected into `process.env`, but only newly
	 * spawned tasks will see it.
	 */
	sendToExtension?: ((msg: WebviewMessage) => void) | null
}

/**
 * Multi-step controlled component:
 *   select provider → (optional alert with sign-up info) → masked API key.
 *
 * Esc at any step cancels the whole flow.
 */
export function ConnectDialog({ onSuccess, onCancel, sendToExtension }: ConnectDialogProps) {
	const dialog = useDialog()
	const [options] = useState(buildProviderOptions)

	const renderApiKeyPrompt = (provider: ProviderName) => (
		<DialogPrompt
			title="Enter your API key"
			message={`Saved to cli-settings.json. Exported as ${getEnvVarName(provider)} for this session.`}
			placeholder={getEnvVarName(provider)}
			mask
			validate={(v) => (v.trim().length === 0 ? "Required" : undefined)}
			onSubmit={async (rawKey) => {
				const key = rawKey.trim()
				try {
					const defaultModel = PROVIDER_DEFAULT_MODEL[provider] ?? ""
					// 1) Persist to cli-settings.json (loaded on next launch).
					//    Save provider, model, and the per-provider key map so
					//    subsequent launches restore the session without
					//    prompting again — mirrors OpenCode's auth.json +
					//    model.json behavior.
					await saveSettings({
						provider,
						model: defaultModel,
						apiKeysByProvider: { [provider]: key },
					})
					// 2a) Persist to model.json (recent / favorite / variant) so
					//     the TUI remembers the provider/model across launches.
					await saveModelStore({
						recent: pushRecent([], { providerID: provider, modelID: defaultModel }),
						favorite: [],
						variant: {},
					})
					// 2b) Inject into process.env so any process spawned from
					//    this session reads the key immediately.
					process.env[getEnvVarName(provider)] = key
					// 3) Forward to the running extension host so the live
					//    task / next task uses the new key without a restart.
					//    Mirrors what the VS Code Settings UI does on save.
					if (sendToExtension) {
						const profileName = `cli-${provider}`
						const apiConfiguration = getProviderSettings(provider, key, defaultModel)
						sendToExtension({
							type: "upsertApiConfiguration",
							text: profileName,
							apiConfiguration,
						})
						sendToExtension({
							type: "loadApiConfiguration",
							text: profileName,
						})
						// Refresh the cached profile list so the rest of the
						// TUI (e.g. footer "connected" indicator) reflects it.
						sendToExtension({ type: "getListApiConfiguration" })
					}
					dialog.pop()
					onSuccess?.(provider)
				} catch {
					// Keep the dialog open; user can retry or Esc out.
				}
			}}
			onCancel={() => {
				dialog.pop()
				onCancel?.()
			}}
		/>
	)

	const advanceToKeyPrompt = (provider: ProviderName) => {
		const preamble = PROVIDER_PREAMBLE[provider]
		if (!preamble) {
			dialog.replace({ size: "medium", render: () => renderApiKeyPrompt(provider) })
			return
		}
		// Show the per-provider info alert first; "OK" advances to the
		// API-key prompt, Esc cancels the whole flow.
		dialog.replace({
			size: "medium",
			render: () => (
				<DialogAlert
					title="Add credential"
					message={preamble}
					okLabel="Continue"
					onClose={() => {
						dialog.replace({ size: "medium", render: () => renderApiKeyPrompt(provider) })
					}}
				/>
			),
		})
	}

	return (
		<DialogSelect
			title="Select provider"
			options={options}
			onSelect={(provider) => advanceToKeyPrompt(provider)}
			onCancel={() => onCancel?.()}
		/>
	)
}
