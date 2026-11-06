import OpenAI from "openai"
import { ensureAllRequired, ensureAdditionalPropertiesFalse } from "../schema-utils"
import { isMcpTool } from "../../../utils/mcp-name"

export function convertToolsForResponsesApi(tools: OpenAI.Chat.ChatCompletionTool[]): Array<{
	type: "function"
	name: string
	description?: string
	parameters?: Record<string, unknown>
	strict?: boolean
}> {
	return tools
		.filter((tool) => tool.type === "function")
		.map((tool) => {
			const isMcp = isMcpTool(tool.function.name)
			// Respect an explicit opt-out: tools with optional nested parameters
			// (e.g. ask_followup_question's suggestion.mode) cannot be strict.
			const explicitlyNonStrict = tool.function.strict === false
			const applyStrict = !isMcp && !explicitlyNonStrict
			return {
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: applyStrict
					? ensureAllRequired(tool.function.parameters)
					: ensureAdditionalPropertiesFalse(tool.function.parameters),
				strict: applyStrict,
			}
		})
}
