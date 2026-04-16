import type { ProviderSettings } from "@njust-ai-cj/types"

/**
 * Core service abstractions for DI (G.2). Implementations stay in core/services modules.
 */
export interface ITaskExecutor {
	/** Identifier for logging / diagnostics */
	readonly id: string
}

export interface IMcpHub {
	waitUntilReady(): Promise<void>
}

export interface IPromptEngine {
	/** Placeholder — wired when prompt pipeline is behind this interface */
	readonly version: string
}

export interface IToolRegistry {
	/** Placeholder — tool registration surface for future DI */
	readonly placeholder?: true
}

/** Return type stays generic to avoid core/di → api barrel circular imports. */
export interface IApiHandlerFactory {
	createHandler(configuration: ProviderSettings): unknown
}
