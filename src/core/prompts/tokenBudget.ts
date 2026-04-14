export type PromptTokenBudget = {
	systemPromptMaxTokens: number
	toolDefinitionMaxTokens: number
	dialogHistoryMinTokens: number
}

const MIN_SYSTEM_PROMPT_TOKENS = 1200

export function estimatePromptTokens(text: string): number {
	if (!text) return 0
	return Math.ceil(text.length / 3.5)
}

export function derivePromptTokenBudget(contextWindow?: number): PromptTokenBudget | null {
	if (!contextWindow || contextWindow <= 0) return null
	const systemPromptMaxTokens = Math.max(MIN_SYSTEM_PROMPT_TOKENS, Math.floor(contextWindow * 0.15))
	const toolDefinitionMaxTokens = Math.max(600, Math.floor(contextWindow * 0.1))
	const dialogHistoryMinTokens = Math.max(2000, Math.floor(contextWindow * 0.5))
	return {
		systemPromptMaxTokens,
		toolDefinitionMaxTokens,
		dialogHistoryMinTokens,
	}
}

function trimToTokenBudget(text: string, maxTokens: number): string {
	const maxChars = Math.max(0, Math.floor(maxTokens * 3.5))
	if (text.length <= maxChars) return text
	const head = text.slice(0, Math.max(0, maxChars - 64)).trimEnd()
	return `${head}\n\n[Prompt section truncated due to token budget]`
}

export type SectionBudget = {
	name: string
	priority: number
	estimatedTokens: number
	required: boolean
}

/**
 * 当段落总 token 超过预算时，按优先级裁剪非必需段落。
 * 返回需要保留的段落名称集合。
 */
export function trimSectionsByBudget(sections: SectionBudget[], maxTokens: number): Set<string> {
	const allNames = new Set(sections.map((s) => s.name))
	const totalTokens = sections.reduce((sum, s) => sum + s.estimatedTokens, 0)
	if (totalTokens <= maxTokens) {
		return allNames
	}

	// Sort non-required sections by priority ascending (lowest priority trimmed first)
	const nonRequired = sections.filter((s) => !s.required).sort((a, b) => a.priority - b.priority)
	const retained = new Set(allNames)
	let currentTokens = totalTokens

	for (const section of nonRequired) {
		if (currentTokens <= maxTokens) break
		retained.delete(section.name)
		currentTokens -= section.estimatedTokens
		console.warn(`[tokenBudget] Trimmed section "${section.name}" (${section.estimatedTokens} tokens) to fit budget`)
	}

	return retained
}

export function applySystemPromptBudget(staticPart: string, dynamicPart: string, contextWindow?: number): {
	staticPart: string
	dynamicPart: string
} {
	const budget = derivePromptTokenBudget(contextWindow)
	if (!budget) return { staticPart, dynamicPart }

	const total = estimatePromptTokens(staticPart) + estimatePromptTokens(dynamicPart)
	if (total <= budget.systemPromptMaxTokens) {
		return { staticPart, dynamicPart }
	}

	const staticTokens = estimatePromptTokens(staticPart)

	// Static itself exceeds budget: trim static first, keep minimal dynamic marker.
	if (staticTokens >= budget.systemPromptMaxTokens) {
		return {
			staticPart: trimToTokenBudget(staticPart, budget.systemPromptMaxTokens),
			dynamicPart: "[Dynamic prompt omitted due to token budget]",
		}
	}

	const allowedDynamic = Math.max(200, budget.systemPromptMaxTokens - staticTokens)
	return {
		staticPart,
		dynamicPart: trimToTokenBudget(dynamicPart, allowedDynamic),
	}
}
