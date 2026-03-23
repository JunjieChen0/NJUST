import type { ModelInfo } from "../model.js"

// https://www.volcengine.com/docs/82379/1554680
// Pricing: https://www.volcengine.com/docs/82379/1544106
// Updated: March 2026
export type DoubaoModelId = keyof typeof doubaoModels

export const doubaoDefaultModelId: DoubaoModelId = "doubao-seed-1.6"

export const doubaoModels = {
	"doubao-seed-1.6": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-1.6 (2026) is ByteDance's flagship model with dynamic deep thinking mechanism, 256K context, and adaptive resource allocation saving 23% compute cost.",
	},
	"doubao-seed-1.6-thinking": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		preserveReasoning: true,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-1.6-Thinking is optimized for complex cognitive tasks with 92.3% accuracy on GSM8K math benchmarks. Deep chain-of-thought reasoning.",
	},
	"doubao-seed-1.6-vision": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.11,
		outputPrice: 1.13,
		cacheReadsPrice: 0.023,
		description:
			"Doubao-Seed-1.6-Vision supports multimodal understanding of text, image, and video with 256K context window.",
	},
	"doubao-seed-code": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-Code is specialized for agentic programming tasks with 256K context, optimized for code generation, debugging, and refactoring.",
	},
	"doubao-1.5-pro-256k": {
		maxTokens: 16_384,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.08,
		description:
			"Doubao-1.5-Pro-256K excels at reasoning, code, and multi-turn dialogue. Benchmarks on par with GPT-4o and Claude 3.5 Sonnet. Very low cost.",
	},
	"doubao-1.5-pro-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.06,
		outputPrice: 0.06,
		description: "Doubao-1.5-Pro with 32K context, optimized for cost efficiency on shorter tasks.",
	},
	"doubao-1.5-lite-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.014,
		outputPrice: 0.028,
		description:
			"Doubao-1.5-Lite is a lightweight model comparable to GPT-4o-mini and Claude 3.5 Haiku at ultra-low cost.",
	},
	"doubao-1.5-vision-pro-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.28,
		outputPrice: 0.28,
		description:
			"Doubao-1.5-Vision-Pro supports arbitrary resolution image input with leading multimodal understanding performance.",
	},
} as const satisfies Record<string, ModelInfo>

export const DOUBAO_DEFAULT_TEMPERATURE = 0.3
