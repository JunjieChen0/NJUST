import type { IToolCallParser } from "../../api/interfaces/IToolCallParser"

import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Injectable adapter over {@link NativeToolCallParser}.
 * Each instance owns its own NativeToolCallParser for per-task isolation.
 */
export class ToolCallParserImpl implements IToolCallParser {
	private readonly parser = new NativeToolCallParser()

	processFinishReason(finishReason: string | null | undefined) {
		return this.parser.processFinishReason(finishReason)
	}

	clearRawChunkState(): void {
		this.parser.clearRawChunkState()
	}

	clearAllStreamingToolCalls(): void {
		this.parser.clearAllStreamingToolCalls()
	}

	getNativeParser(): NativeToolCallParser {
		return this.parser
	}
}

export const defaultToolCallParser = new ToolCallParserImpl()
