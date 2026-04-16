import type { IToolCallParser } from "../../api/interfaces/IToolCallParser"

import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Injectable adapter over {@link NativeToolCallParser} static API (report C.2).
 */
export class ToolCallParserImpl implements IToolCallParser {
	processFinishReason(finishReason: string | null | undefined) {
		return NativeToolCallParser.processFinishReason(finishReason)
	}

	clearRawChunkState(): void {
		NativeToolCallParser.clearRawChunkState()
	}

	clearAllStreamingToolCalls(): void {
		NativeToolCallParser.clearAllStreamingToolCalls()
	}
}

export const defaultToolCallParser = new ToolCallParserImpl()
