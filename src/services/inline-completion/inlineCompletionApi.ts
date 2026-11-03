import { buildApiHandler, type ApiHandler } from "../../api"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import { defaultToolCallParser } from "../../core/assistant-message/ToolCallParserImpl"
import { getErrorMessage } from "../../shared/error-utils"

let loggedMissingApiProfile = false

/**
 * Use the active task's profile in an independent handler so inline and chat streams do not share state.
 */
export async function resolveInlineCompletionApiHandler(
	provider: ClineProvider,
	log?: (message: string) => void,
): Promise<ApiHandler | undefined> {
	const task = provider.getCurrentTask()
	try {
		const apiConfiguration = task ? task.apiConfiguration : (await provider.getState()).apiConfiguration
		if (!apiConfiguration?.apiProvider) {
			if (log && !loggedMissingApiProfile) {
				loggedMissingApiProfile = true
				log(
					"[InlineCompletion] No API profile yet — configure a provider in NJUST_AI settings, or start a chat task (inline completion reuses the same API as the sidebar).",
				)
			}
			return undefined
		}
		loggedMissingApiProfile = false
		const handler = buildApiHandler(apiConfiguration, undefined, { toolCallParser: defaultToolCallParser })
		await handler.prepareModel?.()
		return handler
	} catch (error) {
		log?.(`[InlineCompletion] Could not build API handler: ${getErrorMessage(error)}`)
		return undefined
	}
}
