import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@njust-ai-cj/telemetry"

import { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../api"
import { MAX_CONDENSE_THRESHOLD, MIN_CONDENSE_THRESHOLD, summarizeConversation, SummarizeResponse } from "../condense"
import { ApiMessage } from "../task-persistence/apiMessages"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "@njust-ai-cj/types"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { microcompactMessages } from "./microcompact"
import { snipCompactMessages } from "./snipCompact"
import { contextCollapseMessages } from "./contextCollapse"
import { postCompactRestore } from "./postCompactRestore"
import { shouldSkipCompactForCache, getAdjustedCompactThreshold } from "../condense/cacheAwareCompact"

/**
 * Context Management
 *
 * This module provides Context Management for conversations, combining:
 * - Intelligent condensation of prior messages when approaching configured thresholds
 * - Sliding window truncation as a fallback when necessary
 *
 * Behavior and exports are preserved exactly from the previous sliding-window implementation.
 */

/**
 * Legacy percentage buffer kept for backward compatibility in tests/imports.
 * Dynamic thresholding now primarily uses TOKEN_BUFFER_TOKENS.
 */
export const TOKEN_BUFFER_PERCENTAGE = 0.1

/**
 * Fixed token buffer reserved for tool calls / response headroom.
 */
export const TOKEN_BUFFER_TOKENS = 13000

/**
 * Auto-compact circuit breaker: maximum consecutive condensation failures
 * before falling back to forced truncation.
 *
 * Inspired by Claude Code's autoCompact.ts which discovered that 1,279 sessions
 * experienced 50+ consecutive failures, wasting ~250K API calls daily.
 * The circuit breaker prevents this by cutting off after a small number of failures.
 */
export const MAX_CONSECUTIVE_COMPACT_FAILURES = 3

/**
 * Module-level counter tracking consecutive auto-condensation failures.
 * Resets to 0 on successful condensation.
 */
let consecutiveCompactFailures = 0

/**
 * Resets the circuit breaker failure counter.
 * Exported for testing purposes.
 */
export function resetCompactCircuitBreaker(): void {
	consecutiveCompactFailures = 0
}

/**
 * Counts tokens for user content using the provider's token counting implementation.
 *
 * @param {Array<Anthropic.Messages.ContentBlockParam>} content - The content to count tokens for
 * @param {ApiHandler} apiHandler - The API handler to use for token counting
 * @returns {Promise<number>} A promise resolving to the token count
 */
export async function estimateTokenCount(
	content: Array<Anthropic.Messages.ContentBlockParam>,
	apiHandler: ApiHandler,
): Promise<number> {
	if (!content || content.length === 0) return 0
	return apiHandler.countTokens(content)
}

/**
 * Result of truncation operation, includes the truncation ID for UI events.
 */
export type TruncationResult = {
	messages: ApiMessage[]
	truncationId: string
	messagesRemoved: number
}

/**
 * Message weight constants for intelligent truncation.
 * Higher weight = more valuable = less likely to be truncated.
 */
const MESSAGE_WEIGHTS = {
	ERROR_RECOVERY: 10,
	RECENT_TOOL_WRITE: 8,
	CODE_MODIFICATION: 7,
	RECENT_TOOL_READ: 5,
	SEARCH_RESULT: 4,
	ASSISTANT_REASONING: 3,
	USER_MESSAGE: 3,
	OLD_TOOL_RESULT: 2,
	PURE_TEXT_DIALOG: 1,
} as const

/** Number of recent turns to protect from truncation */
const PROTECTED_RECENT_TURNS = 3

/** Half-life in visible-message steps for age decay */
const AGE_DECAY_HALFLIFE = 12

function hasCodeModification(message: ApiMessage): boolean {
	const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content)
	return /write_to_file|apply_diff|insert_content|search_and_replace/.test(content)
}

function isErrorRecoveryMessage(message: ApiMessage): boolean {
	const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content)
	return /error|retry|recovery|failed|circuit.?breaker/i.test(content)
}

function isToolResult(message: ApiMessage): boolean {
	if (!Array.isArray(message.content)) return false
	return message.content.some((block: any) => block.type === "tool_result")
}

function isToolUseWithWrite(message: ApiMessage): boolean {
	if (!Array.isArray(message.content)) return false
	return message.content.some(
		(block: any) =>
			block.type === "tool_use" &&
			/write_to_file|apply_diff|insert_content|search_and_replace/.test(block.name || ""),
	)
}

function tokenizeForRelevance(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((t) => t.length >= 3),
	)
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0
	let intersection = 0
	for (const token of a) {
		if (b.has(token)) intersection++
	}
	const union = a.size + b.size - intersection
	return union === 0 ? 0 : intersection / union
}

function getMessageBaseWeight(message: ApiMessage, isRecent: boolean): number {
	if (isErrorRecoveryMessage(message)) return MESSAGE_WEIGHTS.ERROR_RECOVERY
	if (hasCodeModification(message) || isToolUseWithWrite(message)) {
		return isRecent ? MESSAGE_WEIGHTS.RECENT_TOOL_WRITE : MESSAGE_WEIGHTS.CODE_MODIFICATION
	}
	if (isToolResult(message)) {
		return isRecent ? MESSAGE_WEIGHTS.RECENT_TOOL_READ : MESSAGE_WEIGHTS.OLD_TOOL_RESULT
	}
	if (message.role === "assistant") return MESSAGE_WEIGHTS.ASSISTANT_REASONING
	if (message.role === "user") return MESSAGE_WEIGHTS.USER_MESSAGE
	return MESSAGE_WEIGHTS.PURE_TEXT_DIALOG
}

function evaluateMessageWeight(
	message: ApiMessage,
	index: number,
	totalVisible: number,
	referenceTokens: Set<string>,
): number {
	const isRecent = index >= totalVisible - PROTECTED_RECENT_TURNS * 2
	const baseWeight = getMessageBaseWeight(message, isRecent)
	const ageSteps = Math.max(0, totalVisible - 1 - index)
	const ageDecay = Math.pow(0.5, ageSteps / AGE_DECAY_HALFLIFE)
	const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content)
	const similarity = jaccardSimilarity(tokenizeForRelevance(text), referenceTokens)
	const relevanceBoost = similarity * 3
	const recencyBoost = isRecent ? 0.5 : 0
	return baseWeight * ageDecay + relevanceBoost + recencyBoost
}

/**
 * Truncates a conversation by tagging messages as hidden instead of removing them.
 *
 * Uses intelligent weight-based truncation: messages are evaluated by importance
 * (error recovery > tool writes > code modifications > tool reads > dialog),
 * and low-priority messages are truncated first. Recent messages are protected.
 *
 * Falls back to simple proportional truncation if smart truncation cannot find
 * enough low-priority candidates.
 *
 * The first message is always retained. A truncation marker is inserted to track
 * where truncation occurred. This implements non-destructive sliding window
 * truncation, allowing messages to be restored if the user rewinds past the
 * truncation point.
 *
 * @param {ApiMessage[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to hide.
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @returns {TruncationResult} Object containing the tagged messages, truncation ID, and count of messages removed.
 */
export function truncateConversation(messages: ApiMessage[], fracToRemove: number, taskId: string): TruncationResult {
	TelemetryService.instance.captureSlidingWindowTruncation(taskId)
	const truncationId = crypto.randomUUID()

	// Filter to only visible messages (those not already truncated)
	const visibleIndices: number[] = []
	messages.forEach((msg, index) => {
		if (!msg.truncationParent && !msg.isTruncationMarker) {
			visibleIndices.push(index)
		}
	})

	const visibleCount = visibleIndices.length
	const rawMessagesToRemove = Math.floor((visibleCount - 1) * fracToRemove)
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2) // Keep even for user/assistant pairs

	if (messagesToRemove <= 0) {
		return { messages, truncationId, messagesRemoved: 0 }
	}

	// === SMART TRUNCATION: dynamic weight-based selection ===
	const lastVisibleMessage = messages[visibleIndices[visibleIndices.length - 1]]
	const referenceText =
		typeof lastVisibleMessage?.content === "string"
			? lastVisibleMessage.content
			: JSON.stringify(lastVisibleMessage?.content ?? "")
	const referenceTokens = tokenizeForRelevance(referenceText)

	const candidateWeights: Array<{ visibleIdx: number; originalIdx: number; weight: number }> = []
	for (let i = 1; i < visibleIndices.length; i++) {
		const originalIdx = visibleIndices[i]
		const weight = evaluateMessageWeight(messages[originalIdx], i, visibleCount, referenceTokens)
		candidateWeights.push({ visibleIdx: i, originalIdx, weight })
	}

	// Protect last PROTECTED_RECENT_TURNS * 2 messages
	const protectedStart = visibleCount - PROTECTED_RECENT_TURNS * 2

	// Sort candidates by weight ascending (lowest weight first = truncated first)
	// For equal weights, prefer older messages (lower index)
	candidateWeights.sort((a, b) => {
		if (a.weight !== b.weight) return a.weight - b.weight
		return a.visibleIdx - b.visibleIdx
	})

	// Select messages to truncate: pick lowest-weight messages, skip protected
	const indicesToTruncate = new Set<number>()
	let removed = 0
	for (const candidate of candidateWeights) {
		if (removed >= messagesToRemove) break
		// Skip protected recent messages
		if (candidate.visibleIdx >= protectedStart) continue
		// Skip error recovery messages (weight >= ERROR_RECOVERY)
		if (candidate.weight >= MESSAGE_WEIGHTS.ERROR_RECOVERY) continue

		indicesToTruncate.add(candidate.originalIdx)
		removed++

		// Also truncate the paired message (user/assistant pair)
		const msg = messages[candidate.originalIdx]
		const pairedVisibleIdx = msg.role === "user" ? candidate.visibleIdx + 1 : candidate.visibleIdx - 1
		if (
			pairedVisibleIdx > 0 &&
			pairedVisibleIdx < visibleIndices.length &&
			pairedVisibleIdx < protectedStart
		) {
			const pairedOriginalIdx = visibleIndices[pairedVisibleIdx]
			if (!indicesToTruncate.has(pairedOriginalIdx)) {
				indicesToTruncate.add(pairedOriginalIdx)
				removed++
			}
		}
	}

	// Fallback: if smart truncation couldn't find enough candidates, use original proportional approach
	if (removed === 0) {
		const fallbackIndicesToTruncate = new Set(visibleIndices.slice(1, messagesToRemove + 1))
		const fallbackTaggedMessages = messages.map((msg, index) => {
			if (fallbackIndicesToTruncate.has(index)) {
				return { ...msg, truncationParent: truncationId }
			}
			return msg
		})

		const fallbackFirstKeptVisibleIndex = visibleIndices[messagesToRemove + 1] ?? fallbackTaggedMessages.length
		const fallbackFirstKeptTs = messages[fallbackFirstKeptVisibleIndex]?.ts ?? Date.now()
		const fallbackMarker: ApiMessage = {
			role: "user",
			content: `[Sliding window truncation: ${messagesToRemove} messages hidden to reduce context]`,
			ts: fallbackFirstKeptTs - 1,
			isTruncationMarker: true,
			truncationId,
		}

		const fallbackResult = [
			...fallbackTaggedMessages.slice(0, fallbackFirstKeptVisibleIndex),
			fallbackMarker,
			...fallbackTaggedMessages.slice(fallbackFirstKeptVisibleIndex),
		]

		return { messages: fallbackResult, truncationId, messagesRemoved: messagesToRemove }
	}

	// Tag selected messages as truncated
	const taggedMessages = messages.map((msg, index) => {
		if (indicesToTruncate.has(index)) {
			return { ...msg, truncationParent: truncationId }
		}
		return msg
	})

	// Insert truncation marker: find the first non-truncated visible message after truncated ones
	let firstKeptVisibleIndex = taggedMessages.length
	for (const idx of visibleIndices) {
		if (!indicesToTruncate.has(idx) && idx !== visibleIndices[0]) {
			firstKeptVisibleIndex = idx
			break
		}
	}

	const firstKeptTs = messages[firstKeptVisibleIndex]?.ts ?? Date.now()
	const truncationMarker: ApiMessage = {
		role: "user",
		content: `[Intelligent truncation: ${removed} low-priority messages hidden to reduce context]`,
		ts: firstKeptTs - 1,
		isTruncationMarker: true,
		truncationId,
	}

	const insertPosition = firstKeptVisibleIndex
	const result = [
		...taggedMessages.slice(0, insertPosition),
		truncationMarker,
		...taggedMessages.slice(insertPosition),
	]

	return { messages: result, truncationId, messagesRemoved: removed }
}

/**
 * Options for checking if context management will likely run.
 * A subset of ContextManagementOptions with only the fields needed for threshold calculation.
 */
export type WillManageContextOptions = {
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	currentProfileId: string
	lastMessageTokens: number
}

/**
 * Checks whether context management (condensation or truncation) will likely run based on current token usage.
 *
 * This is useful for showing UI indicators before `manageContext` is actually called,
 * without duplicating the threshold calculation logic.
 *
 * @param {WillManageContextOptions} options - The options for threshold calculation
 * @returns {boolean} True if context management will likely run, false otherwise
 */
export function willManageContext({
	totalTokens,
	contextWindow,
	maxTokens,
	autoCondenseContext,
	autoCondenseContextPercent,
	profileThresholds,
	currentProfileId,
	lastMessageTokens,
}: WillManageContextOptions): boolean {
	if (!autoCondenseContext) {
		// When auto-condense is disabled, only truncation can occur
		const reservedTokens = maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS
		const prevContextTokens = totalTokens + lastMessageTokens
		const allowedTokens = Math.max(0, contextWindow - reservedTokens - TOKEN_BUFFER_TOKENS)
		return prevContextTokens > allowedTokens
	}

	const reservedTokens = maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS
	const prevContextTokens = totalTokens + lastMessageTokens
	const allowedTokens = Math.max(0, contextWindow - reservedTokens - TOKEN_BUFFER_TOKENS)

	// Determine the effective threshold to use
	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			effectiveThreshold = profileThreshold
		}
		// Invalid values fall back to global setting (effectiveThreshold already set)
	}

	const contextPercent = (100 * prevContextTokens) / contextWindow
	return contextPercent >= effectiveThreshold || prevContextTokens > allowedTokens
}

/**
 * Context Management: Conditionally manages the conversation context when approaching limits.
 *
 * Attempts intelligent condensation of prior messages when thresholds are reached.
 * Falls back to sliding window truncation if condensation is unavailable or fails.
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */

export type ContextManagementOptions = {
	messages: ApiMessage[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	apiHandler: ApiHandler
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	systemPrompt: string
	taskId: string
	customCondensingPrompt?: string
	profileThresholds: Record<string, number>
	currentProfileId: string
	/** Optional metadata to pass through to the condensing API call (tools, taskId, etc.) */
	metadata?: ApiHandlerCreateMessageMetadata
	/** Optional environment details string to include in the condensed summary */
	environmentDetails?: string
	/** Optional array of file paths read by Roo during the task (will be folded via tree-sitter) */
	filesReadByRoo?: string[]
	/** Optional current working directory for resolving file paths (required if filesReadByRoo is provided) */
	cwd?: string
	/** Optional controller for file access validation */
	rooIgnoreController?: RooIgnoreController
	/** Optional: tokens served from provider prompt cache (for cache-aware compression) */
	cacheReadTokens?: number
	/** Optional: total tokens for computing cache ratio denominator in cache-aware logic */
	cacheAwareTotalTokens?: number
	/** Optional: enable micro compact preprocessing before condense/truncate logic */
	enableMicroCompact?: boolean
}

export type ContextManagementResult = SummarizeResponse & {
	prevContextTokens: number
	truncationId?: string
	messagesRemoved?: number
	newContextTokensAfterTruncation?: number
}

/**
 * Conditionally manages conversation context (condense and fallback truncation).
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */
export async function manageContext({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
	apiHandler,
	autoCondenseContext,
	autoCondenseContextPercent,
	systemPrompt,
	taskId,
	customCondensingPrompt,
	profileThresholds,
	currentProfileId,
	metadata,
	environmentDetails,
	filesReadByRoo,
	cwd,
	rooIgnoreController,
	cacheReadTokens,
	cacheAwareTotalTokens,
	enableMicroCompact = true,
}: ContextManagementOptions): Promise<ContextManagementResult> {
	let error: string | undefined
	let errorDetails: string | undefined
	let cost = 0
	// Calculate the maximum tokens reserved for response
	const reservedTokens = maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS
	const contextPercent = contextWindow > 0 ? (100 * totalTokens) / contextWindow : 0
	const baseMessages = enableMicroCompact ? microcompactMessages(messages) : messages
	const compacted = snipCompactMessages(baseMessages, { contextPercent })
	const collapsed = contextCollapseMessages(compacted, { contextPercent })
	const preprocessedMessages = collapsed.messages

	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = preprocessedMessages[preprocessedMessages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? await estimateTokenCount(lastMessageContent, apiHandler)
		: await estimateTokenCount([{ type: "text", text: lastMessageContent as string }], apiHandler)

	// Calculate total effective tokens (totalTokens never includes the last message)
	const prevContextTokens = totalTokens + lastMessageTokens

	// Calculate available tokens for conversation history
	// Truncate if we're within TOKEN_BUFFER_PERCENTAGE of the context window
	const allowedTokens = Math.max(0, contextWindow - reservedTokens - TOKEN_BUFFER_TOKENS)

	// Determine the effective threshold to use
	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			// Special case: -1 means inherit from global setting
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			// Valid custom threshold
			effectiveThreshold = profileThreshold
		} else {
			// Invalid threshold value, fall back to global setting
			console.warn(
				`Invalid profile threshold ${profileThreshold} for profile "${currentProfileId}". Using global default of ${autoCondenseContextPercent}%`,
			)
			effectiveThreshold = autoCondenseContextPercent
		}
	}
	// If no specific threshold is found for the profile, fall back to global setting

	if (autoCondenseContext) {
		const contextPercent = (100 * prevContextTokens) / contextWindow

		// Cache-aware threshold adjustment: if prompt cache is being utilized well,
		// raise the threshold to avoid breaking the cache prematurely
		const cacheAwareTokensBase = cacheAwareTotalTokens ?? totalTokens
		const adjustedThreshold = cacheReadTokens !== undefined
			? getAdjustedCompactThreshold(effectiveThreshold, cacheReadTokens, cacheAwareTokensBase)
			: effectiveThreshold

		if (contextPercent >= adjustedThreshold || prevContextTokens > allowedTokens) {
			// Cache-aware check: skip compression if prompt cache hit rate is very high
			if (cacheReadTokens !== undefined && shouldSkipCompactForCache(cacheReadTokens, cacheAwareTokensBase)) {
				console.log(
					`[Context Management] Skipping auto-compact: high prompt cache hit rate ` +
					`(${((cacheReadTokens / Math.max(1, cacheAwareTokensBase)) * 100).toFixed(1)}%). ` +
					`Compression would break cache and increase costs.`,
				)
				// Fall through to truncation check below if tokens still exceed allowed
			}
			// Circuit breaker: if condensation has failed too many times consecutively,
			// skip it and fall through to truncation to avoid wasting API calls
			else if (consecutiveCompactFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES) {
				console.warn(
					`[Context Management] Circuit breaker triggered: ` +
					`${consecutiveCompactFailures} consecutive condensation failures. ` +
					`Falling back to forced truncation.`,
				)
				// Force aggressive truncation (75% removal)
				const truncationResult = truncateConversation(preprocessedMessages, 0.75, taskId)
				return {
					messages: truncationResult.messages,
					prevContextTokens,
					summary: "",
					cost: 0,
					error: "Circuit breaker: forced truncation after repeated condensation failures",
					truncationId: truncationResult.truncationId,
					messagesRemoved: truncationResult.messagesRemoved,
				}
			} else {
				// Attempt to intelligently condense the context
				const result = await summarizeConversation({
					messages: preprocessedMessages,
					apiHandler,
					systemPrompt,
					taskId,
					isAutomaticTrigger: true,
					customCondensingPrompt,
					metadata,
					environmentDetails,
					filesReadByRoo,
					cwd,
					rooIgnoreController,
				})
				if (result.error) {
					// Condensation failed - increment circuit breaker counter
					consecutiveCompactFailures++
					console.warn(
						`[Context Management] Condensation failed (attempt ${consecutiveCompactFailures}/${MAX_CONSECUTIVE_COMPACT_FAILURES}): ${result.error}`,
					)
					error = result.error
					errorDetails = result.errorDetails
					cost = result.cost
				} else {
					// Success - reset circuit breaker counter
					consecutiveCompactFailures = 0
					const restored = postCompactRestore(result.messages, {
						recentFiles: filesReadByRoo?.slice(-5),
						activeSkills: undefined,
						mcpDelta: undefined,
					})
					return { ...result, messages: restored, prevContextTokens }
				}
			}
		}
	}

	// Fall back to sliding window truncation if needed
	if (prevContextTokens > allowedTokens) {
		const truncationResult = truncateConversation(preprocessedMessages, 0.5, taskId)

		// Calculate new context tokens after truncation by counting non-truncated messages
		// Messages with truncationParent are hidden, so we count only those without it
		const effectiveMessages = truncationResult.messages.filter(
			(msg) => !msg.truncationParent && !msg.isTruncationMarker,
		)

		// Include system prompt tokens so this value matches what we send to the API.
		// Note: `prevContextTokens` is computed locally here (totalTokens + lastMessageTokens).
		let newContextTokensAfterTruncation = await estimateTokenCount(
			[{ type: "text", text: systemPrompt }],
			apiHandler,
		)

		for (const msg of effectiveMessages) {
			const content = msg.content
			if (Array.isArray(content)) {
				newContextTokensAfterTruncation += await estimateTokenCount(content, apiHandler)
			} else if (typeof content === "string") {
				newContextTokensAfterTruncation += await estimateTokenCount(
					[{ type: "text", text: content }],
					apiHandler,
				)
			}
		}

		return {
			messages: truncationResult.messages,
			prevContextTokens,
			summary: "",
			cost,
			error,
			errorDetails,
			truncationId: truncationResult.truncationId,
			messagesRemoved: truncationResult.messagesRemoved,
			newContextTokensAfterTruncation,
		}
	}
	// No truncation or condensation needed
	return { messages: preprocessedMessages, summary: "", cost, prevContextTokens, error, errorDetails }
}
