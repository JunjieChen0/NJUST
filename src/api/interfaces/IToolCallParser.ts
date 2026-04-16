import type {
	ApiStreamToolCallDeltaChunk,
	ApiStreamToolCallEndChunk,
	ApiStreamToolCallStartChunk,
} from "../transform/stream"

/** Matches NativeToolCallParser's ToolCallStreamEvent. */
export type ToolCallParserStreamEvent =
	| ApiStreamToolCallStartChunk
	| ApiStreamToolCallDeltaChunk
	| ApiStreamToolCallEndChunk

/**
 * Abstraction over native tool-call parsing (streaming + finish handling).
 * API providers depend on this instead of importing core/assistant-message directly.
 */
export interface IToolCallParser {
	processFinishReason(finishReason: string | null | undefined): ToolCallParserStreamEvent[]

	/** Static streaming helpers are instance methods for injectability in tests. */
	clearRawChunkState?(): void
	clearAllStreamingToolCalls?(): void
}
