/**
 * Re-export from shared layer.
 *
 * Implementation moved to `src/shared/promptCacheBreakDetection.ts` to break
 * the api -> core reverse dependency. Existing core/ consumers
 * continue importing from this file for backward compatibility.
 */
export {
	PromptCacheBreakDetector,
	globalPromptCacheBreakDetector,
	normalizePromptContent,
	type CacheBreakEvent,
	type CacheBreakSource,
} from "../../shared/promptCacheBreakDetection"
