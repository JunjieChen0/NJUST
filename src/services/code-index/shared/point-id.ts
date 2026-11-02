import { v5 as uuidv5 } from "uuid"

import { QDRANT_CODE_BLOCK_NAMESPACE } from "../constants"

/**
 * Qdrant point id for a code block. Full scans and incremental file-watcher
 * updates must share this so both write the same id for the same segment.
 * segmentHash covers the char offset, so segments split from one long line differ.
 */
export function codeBlockPointId(segmentHash: string): string {
	return uuidv5(segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)
}
