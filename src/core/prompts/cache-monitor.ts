/**
 * Re-export from shared layer.
 *
 * Implementation moved to `src/shared/cache-monitor.ts` to break
 * the api -> core reverse dependency. Existing core/ consumers
 * continue importing from this file for backward compatibility.
 */
export { summarizePromptCacheUsage, type PromptCacheUsage } from "../../shared/cache-monitor"
