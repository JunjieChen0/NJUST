import { isRetiredProvider, type ProviderSettings } from "@njust-ai-cj/types"

import type { ApiHandler } from "../index"
import type { ApiHandlerOptions } from "../../shared/api"
import { defaultToolCallParser } from "../../core/assistant-message/ToolCallParserImpl"

import {
	AnthropicHandler,
	AwsBedrockHandler,
	OpenRouterHandler,
	VertexHandler,
	AnthropicVertexHandler,
	OpenAiHandler,
	OpenAiCodexHandler,
	LmStudioHandler,
	GeminiHandler,
	OpenAiNativeHandler,
	DeepSeekHandler,
	MoonshotHandler,
	MistralHandler,
	VsCodeLmHandler,
	RequestyHandler,
	UnboundHandler,
	FakeAIHandler,
	XAIHandler,
	LiteLLMHandler,
	QwenCodeHandler,
	SambaNovaHandler,
	ZAiHandler,
	FireworksHandler,
	RooHandler,
	VercelAiGatewayHandler,
	MiniMaxHandler,
	BasetenHandler,
	QwenHandler,
	DoubaoHandler,
	GlmHandler,
} from "../providers"
import { NativeOllamaHandler } from "../providers/native-ollama"

export type ProviderId = NonNullable<ProviderSettings["apiProvider"]>

export type TokenCountingStrategy = "native" | "tiktoken" | "estimated"

export type ProviderFactory = (options: ApiHandlerOptions) => ApiHandler

export interface ProviderRegistration {
	factory: ProviderFactory
	tokenCountingStrategy: TokenCountingStrategy
}

/**
 * Central registry for API handler construction (report D.1).
 *
 * Supports self-registration: individual provider modules can call
 * `providerRegistry.register(id, factory)` at import time instead of
 * adding entries to registerDefaults(). The built-in defaults remain
 * as a fallback for providers that haven't migrated yet.
 */
export class ProviderRegistry {
	private readonly factories = new Map<ProviderId, ProviderFactory>()
	private readonly strategies = new Map<ProviderId, TokenCountingStrategy>()

	constructor() {
		this.registerDefaults()
	}

	/**
	 * Register (or override) a handler factory for a provider ID.
	 * Providers can call this at module load time for self-registration.
	 */
	register(id: ProviderId, factory: ProviderFactory, strategy?: TokenCountingStrategy): void {
		this.factories.set(id, factory)
		this.strategies.set(id, strategy ?? "tiktoken")
	}

	/** List all currently registered provider IDs. */
	getRegisteredIds(): ProviderId[] {
		return [...this.factories.keys()]
	}

	getTokenCountingStrategy(id: ProviderId): TokenCountingStrategy {
		return this.strategies.get(id) ?? "tiktoken"
	}

	private registerDefaults(): void {
		this.register("anthropic", (o) => new AnthropicHandler(o), "native")
		this.register("openrouter", (o) => new OpenRouterHandler(o))
		this.register("bedrock", (o) => new AwsBedrockHandler(o), "native")
		this.register("openai", (o) => new OpenAiHandler(o))
		this.register("ollama", (o) => new NativeOllamaHandler(o), "estimated")
		this.register("lmstudio", (o) => new LmStudioHandler(o), "estimated")
		this.register("gemini", (o) => new GeminiHandler(o))
		this.register("openai-codex", (o) => new OpenAiCodexHandler(o))
		this.register("openai-native", (o) => new OpenAiNativeHandler(o))
		this.register("deepseek", (o) => new DeepSeekHandler(o))
		this.register("qwen-code", (o) => new QwenCodeHandler(o))
		this.register("moonshot", (o) => new MoonshotHandler(o))
		this.register("vscode-lm", (o) => new VsCodeLmHandler(o))
		this.register("mistral", (o) => new MistralHandler(o))
		this.register("requesty", (o) => new RequestyHandler(o))
		this.register("unbound", (o) => new UnboundHandler(o))
		this.register("fake-ai", (o) => new FakeAIHandler(o), "estimated")
		this.register("xai", (o) => new XAIHandler(o))
		this.register("litellm", (o) => new LiteLLMHandler(o))
		this.register("sambanova", (o) => new SambaNovaHandler(o))
		this.register("zai", (o) => new ZAiHandler(o))
		this.register("fireworks", (o) => new FireworksHandler(o))
		this.register("roo", (o) => new RooHandler(o))
		this.register("vercel-ai-gateway", (o) => new VercelAiGatewayHandler(o))
		this.register("minimax", (o) => new MiniMaxHandler(o))
		this.register("baseten", (o) => new BasetenHandler(o))
		this.register("qwen", (o) => new QwenHandler(o))
		this.register("doubao", (o) => new DoubaoHandler(o))
		this.register("glm", (o) => new GlmHandler(o))
		this.register(
			"vertex",
			(o) => (o.apiModelId?.startsWith("claude") ? new AnthropicVertexHandler(o) : new VertexHandler(o)),
			"native",
		)
	}

	createHandler(configuration: ProviderSettings): ApiHandler {
		const { apiProvider, ...optionsBase } = configuration
		const options: ApiHandlerOptions = {
			...optionsBase,
			toolCallParser: defaultToolCallParser,
		}

		if (apiProvider && isRetiredProvider(apiProvider)) {
			throw new Error(
				`Sorry, this provider is no longer supported. We saw very few Roo users actually using it and we need to reduce the surface area of our codebase so we can keep shipping fast and serving our community well in this space. It was a really hard decision but it lets us focus on what matters most to you. It sucks, we know.\n\nPlease select a different provider in your API profile settings.`,
			)
		}

		const id = apiProvider ?? "anthropic"
		const factory = this.factories.get(id as ProviderId)
		if (factory) {
			return factory(options)
		}
		return new AnthropicHandler(options)
	}
}

export const providerRegistry = new ProviderRegistry()
