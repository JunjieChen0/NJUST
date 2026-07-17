/**
 * Prompt generation constants.
 *
 * Centralises magic numbers previously scattered across system.ts and
 * related prompt files.  All token-budget thresholds, scaling factors,
 * and context-window tiers live here so they can be tuned in one place.
 */

// ---------------------------------------------------------------------------
// Context-window tiers for Cangjie token-budget derivation
// ---------------------------------------------------------------------------

/** Minimum context-window size (tokens) to attempt Cangjie budgeting. */
export const MIN_CONTEXT_WINDOW_FOR_CANGJIE = 4_096

/** Context-window tier boundaries (tokens). */
export const CONTEXT_WINDOW_TIER_200K = 200_000
export const CONTEXT_WINDOW_TIER_100K = 100_000
export const CONTEXT_WINDOW_TIER_64K = 64_000
export const CONTEXT_WINDOW_TIER_32K = 32_000
export const CONTEXT_WINDOW_TIER_16K = 16_000

/** Cangjie token budgets per tier. */
export const CANGJIE_BUDGET_TIER_200K = 6_000
export const CANGJIE_BUDGET_TIER_100K = 4_500
export const CANGJIE_BUDGET_TIER_64K = 3_800
export const CANGJIE_BUDGET_TIER_32K = 3_000
export const CANGJIE_BUDGET_TIER_16K = 2_400

/** Minimum Cangjie budget floor when scaling by context window. */
export const CANGJIE_BUDGET_MIN_FLOOR = 800

/** Scaling factor applied when context window is below the smallest tier. */
export const CANGJIE_BUDGET_SCALE_FACTOR = 0.08

// ---------------------------------------------------------------------------
// Follow-up turn compression
// ---------------------------------------------------------------------------

/** Compression coefficient applied to Cangjie budget on follow-up turns. */
export const CANGJIE_FOLLOWUP_COMPRESSION_RATIO = 0.65
