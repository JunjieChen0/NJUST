import delay from "delay"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	type ContextCondense,
	type ContextTruncation,
	DEFAULT_REQUEST_DELAY_SECONDS,
	TelemetryEventName,
} from "@njust-ai/types"

import type { Task } from "./Task"
import type { ApiHandlerCreateMessageMetadata } from "../../api"
import { resolveParallelNativeToolCalls } from "../../shared/parallelToolCalls"
import { getModelMaxOutputTokens } from "../../shared/api"

import { manageContext } from "../context-management"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { buildNativeToolsArrayWithRestrictions } from "./build-tools"

import type { ApiMessage } from "../task-persistence"
import { getLastGlobalApiRequestTime } from "./globalApiTiming"
import { PersistentRetryManager } from "./PersistentRetry"
import { logger } from "../../shared/logger"
import { TIMING, LIMITS } from "../../shared/constants"
import { TaskAbortedError } from "./TaskErrors"
import { TelemetryService } from "@njust-ai/telemetry"

const MAX_EXPONENTIAL_BACKOFF_SECONDS = TIMING.MAX_EXPONENTIAL_BACKOFF_MS / 1000
const FORCED_CONTEXT_REDUCTION_PERCENT = LIMITS.FORCED_CONTEXT_REDUCTION_PERCENT

type ContentOrReasoning = Anthropic.Messages.ContentBlockParam | ReasoningBlock

type ProviderErrorInfo = {
	status?: number
	statusCode?: number
	message?: string
	code?: string
	errorDetails?: Array<
		Record<string, unknown> & { retryDelay?: { match?: (pattern: RegExp) => RegExpMatchArray | null } }
	>
}

function asErrorInfo(error: unknown): ProviderErrorInfo {
	return error && typeof error === "object" ? (error as ProviderErrorInfo) : {}
}

/**
 * TaskStreamProcessor handles stream-related helper logic extracted from Task.ts,
 * including rate limiting, exponential backoff, context window recovery,
 * conversation history cleaning, and safe file listing.
 *
 * Uses the delegation pattern: accesses Task instance properties via `this.task`.
 */
export class TaskStreamProcessor {
	public persistentRetry: PersistentRetryManager = new PersistentRetryManager()

	constructor(private task: Task) {}

	/**
	 * Safely get files read by Njust-AI, catching errors.
	 */
	async getFilesReadByRooSafely(_context: string): Promise<string[] | undefined> {
		try {
			return await this.task.fileContextTracker.getFilesReadByRoo()
		} catch (error) {
			logger.error("TaskStreamProcessor", `Failed to get files read by Njust-AI:`, error)
			TelemetryService.reportError(
				error instanceof Error ? error : new Error(String(error)),
				TelemetryEventName.UTILITY_ERROR,
			)
			return undefined
		}
	}

	/**
	 * Get the current profile ID from provider state.
	 */
	getCurrentProfileId(
		state: { listApiConfigMeta?: Array<{ id?: string; name?: string }>; currentApiConfigName?: string } | undefined,
	): string {
		return (
			state?.listApiConfigMeta?.find((profile) => profile.name === state?.currentApiConfigName)?.id ?? "default"
		)
	}

	/**
	 * Enforce the user-configured provider rate limit.
	 *
	 * NOTE: This is intentionally treated as expected behavior and is surfaced via
	 * the `api_req_rate_limit_wait` say type (not an error).
	 */
	async maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void> {
		const state = await this.task.providerRef.deref()?.getState()
		const rateLimitSeconds =
			state?.apiConfiguration?.rateLimitSeconds ?? this.task.apiConfiguration?.rateLimitSeconds ?? 0
		const lastRequestTime = getLastGlobalApiRequestTime()

		if (rateLimitSeconds <= 0 || lastRequestTime === undefined) {
			return
		}

		const now = performance.now()
		const timeSinceLastRequest = now - lastRequestTime
		const rateLimitDelay = Math.ceil(
			Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - timeSinceLastRequest) / 1000),
		)

		// Only show the countdown UX on the first attempt. Retry flows have their own delay messaging.
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			for (let i = rateLimitDelay; i > 0; i--) {
				// Send structured JSON data for i18n-safe transport
				const delayMessage = JSON.stringify({ seconds: i })
				await this.task.say("api_req_rate_limit_wait", delayMessage, undefined, true)
				await delay(1000)
			}
			// Finalize the partial message so the UI doesn't keep rendering an in-progress spinner.
			await this.task.say("api_req_rate_limit_wait", undefined, undefined, false)
		}
	}

	/**
	 * Check if a timeout error should be retried or if model fallback is needed.
	 * Returns { allowed, shouldFallback, suggestedDelayMs } based on persistent retry state.
	 */
	checkTimeoutRetry(): {
		allowed: boolean
		shouldFallback: boolean
		suggestedDelayMs: number
		reason: string
	} {
		const result = this.persistentRetry.canRetry("timeout")
		return {
			allowed: result.allowed,
			shouldFallback: result.shouldFallback,
			suggestedDelayMs: result.suggestedDelayMs,
			reason: result.reason,
		}
	}

	/**
	 * Shared exponential backoff for retries (first-chunk and mid-stream).
	 * Integrates with PersistentRetryManager for cross-request retry tracking
	 * and timeout degradation.
	 */
	async backoffAndAnnounce(retryAttempt: number, error: unknown): Promise<void> {
		const err = asErrorInfo(error)
		try {
			// Determine error category for persistent retry tracking
			const errorCategory = this.inferErrorCategory(error)

			// Check persistent retry budget before proceeding
			const retryCheck = this.persistentRetry.canRetry(errorCategory)
			if (!retryCheck.allowed) {
				logger.warn(
					"TaskStreamProcessor",
					`Persistent retry denied for '${errorCategory}' on task ${this.task.taskId}: ${retryCheck.reason}` +
						(retryCheck.shouldFallback ? " → suggesting model fallback" : ""),
				)
			}

			const state = await this.task.providerRef.deref()?.getState()
			const baseDelay = state?.requestDelaySeconds ?? DEFAULT_REQUEST_DELAY_SECONDS

			const unattendedMaxBackoffSeconds = state?.unattendedMaxBackoffSeconds ?? MAX_EXPONENTIAL_BACKOFF_SECONDS
			let exponentialDelay = Math.min(
				Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
				unattendedMaxBackoffSeconds,
			)

			// Use persistent retry suggested delay if it's larger
			const persistentSuggestedDelaySec = Math.ceil(retryCheck.suggestedDelayMs / 1000)
			exponentialDelay = Math.max(exponentialDelay, persistentSuggestedDelaySec)

			// Respect provider rate limit window
			let rateLimitDelay = 0
			const rateLimit = (state?.apiConfiguration ?? this.task.apiConfiguration)?.rateLimitSeconds || 0
			if (getLastGlobalApiRequestTime() && rateLimit > 0) {
				const elapsed = performance.now() - getLastGlobalApiRequestTime()!
				rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
			}

			// Drain token bucket on 429 (enforce proactive backoff)
			if (err.status === 429) {
				const providerKey = this.task.apiConfiguration?.apiProvider ?? "default"
				try {
					const { TokenBucketRateLimiter } = await import(
						"../../services/rate-limiter/TokenBucketRateLimiter"
					)
					await TokenBucketRateLimiter.getInstance().drain(providerKey)
				} catch {
					/* best-effort */
				}
			}

			// Prefer RetryInfo on 429 if present
			if (err.status === 429) {
				const retryInfo = err.errorDetails?.find(
					(d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
				)
				const match = retryInfo?.retryDelay?.match?.(/^(\d+)s$/)
				if (match) {
					exponentialDelay = Number(match[1]) + 1
				}
			}

			const finalDelay = Math.max(exponentialDelay, rateLimitDelay)

			// Record the retry in persistent state
			this.persistentRetry.recordRetry(errorCategory, finalDelay * 1000)

			if (finalDelay <= 0) {
				return
			}

			// Build header text; fall back to error message if none provided
			let headerText
			if (err.status) {
				// Include both status code (for ChatRow parsing) and detailed message (for error details)
				// Format: "<status>\n<message>" allows ChatRow to extract status via parseInt(text.substring(0,3))
				// while preserving the full error message in errorDetails for debugging
				const errorMessage = err.message || "Unknown error"
				headerText = `${err.status}\n${errorMessage}`
			} else if (err.message) {
				headerText = err.message
			} else {
				headerText = "Unknown error"
			}

			headerText = headerText ? `${headerText}\n` : ""

			// Show countdown timer with exponential backoff
			for (let i = finalDelay; i > 0; i--) {
				// Check abort flag during countdown to allow early exit
				if (this.task.abort) {
					throw new TaskAbortedError(this.task.taskId, this.task.instanceId)
				}

				await this.task.say(
					"api_req_retry_delayed",
					`${headerText}<retry_timer>${i}</retry_timer>`,
					undefined,
					true,
				)
				await delay(1000)
			}

			await this.task.say("api_req_retry_delayed", headerText, undefined, false)

			// Log persistent retry stats after each backoff for diagnostics
			const stats = this.persistentRetry.getStats()
			if (stats.totalRetries > 0) {
				logger.info(
					"TaskStreamProcessor",
					`Persistent retry stats for task ${this.task.taskId}: total=${stats.totalRetries}, ` +
						`exhausted=${stats.isExhausted}, category='${errorCategory}' count=${stats.records.get(errorCategory)?.count ?? 0}`,
				)
			}
		} catch (err) {
			if (this.task.abort) {
				return
			}

			logger.error("TaskStreamProcessor", "Exponential backoff failed:", err)
			TelemetryService.reportError(
				err instanceof Error ? err : new Error(String(err)),
				TelemetryEventName.UTILITY_ERROR,
			)
		}
	}

	/**
	 * Infer the error category from an error object for persistent retry tracking.
	 * Uses status codes and error messages as heuristics.
	 */
	private inferErrorCategory(error: unknown): string {
		if (!error) {
			return "unknown"
		}

		const err = asErrorInfo(error)
		const status = err.status ?? err.statusCode
		const message = (err.message ?? "").toLowerCase()

		// Timeout detection
		if (
			message.includes("timeout") ||
			message.includes("timed out") ||
			message.includes("etimedout") ||
			err.code === "ETIMEDOUT" ||
			err.code === "ESOCKETTIMEDOUT"
		) {
			return "timeout"
		}

		// Connection errors
		if (
			message.includes("econnreset") ||
			message.includes("econnrefused") ||
			message.includes("epipe") ||
			err.code === "ECONNRESET" ||
			err.code === "ECONNREFUSED"
		) {
			return "connection"
		}

		// HTTP status-based classification
		if (status === 429) {
			return "rate_limit"
		}
		if (status === 529) {
			return "capacity"
		}
		if (status === 503) {
			return "model_overloaded"
		}
		if (status === 500) {
			return "server_error"
		}
		if (status === 401 || status === 403) {
			return "authentication"
		}
		if (status === 413) {
			return "media_too_large"
		}

		return "unknown"
	}

	/**
	 * Handle context window exceeded errors by forcing truncation.
	 */
	async handleContextWindowExceededError(): Promise<void> {
		const state = await this.task.providerRef.deref()?.getState()
		const { profileThresholds = {}, mode, apiConfiguration } = state ?? {}

		const { contextTokens } = this.task.getTokenUsage()
		const modelInfo = this.task.api.getModel().info

		const maxTokens = getModelMaxOutputTokens({
			modelId: this.task.api.getModel().id,
			model: modelInfo,
			settings: this.task.apiConfiguration,
		})

		const contextWindow = modelInfo.contextWindow

		// Get the current profile ID using the helper method
		const currentProfileId = this.getCurrentProfileId(state)

		// Log the context window error for debugging
		logger.warn(
			"TaskStreamProcessor",
			`Context window exceeded for task ${this.task.taskId}, model ${this.task.api.getModel().id}. ` +
				`Current tokens: ${contextTokens}, Context window: ${contextWindow}. ` +
				`Forcing truncation to ${FORCED_CONTEXT_REDUCTION_PERCENT}% of current context.`,
		)
		// Send condenseTaskContextStarted to show in-progress indicator
		await this.task.providerRef
			.deref()
			?.postMessageToWebview({ type: "condenseTaskContextStarted", text: this.task.taskId })

		// Build tools for condensing metadata (same tools used for normal API calls)
		const provider = this.task.providerRef.deref()
		let allTools: import("openai").default.Chat.ChatCompletionTool[] = []
		if (provider) {
			const toolsResult = await buildNativeToolsArrayWithRestrictions({
				provider,
				cwd: this.task.cwd,
				mode,
				customModes: state?.customModes,
				experiments: state?.experiments,
				apiConfiguration,
				disabledTools: state?.disabledTools,
				enableWebSearch: state?.enableWebSearch,
				modelInfo,
				includeAllToolsWithRestrictions: false,
			})
			allTools = toolsResult.tools
		}

		// Build metadata with tools and taskId for the condensing API call
		const metadata: ApiHandlerCreateMessageMetadata = {
			mode,
			taskId: this.task.taskId,
			...(allTools.length > 0
				? {
						tools: allTools,
						tool_choice: "auto",
						parallelToolCalls: resolveParallelNativeToolCalls(apiConfiguration),
					}
				: {}),
		}

		try {
			// Generate environment details to include in the condensed summary
			const environmentDetails = await getEnvironmentDetails(this.task, true)

			// Force aggressive truncation by keeping only 75% of the conversation history
			const truncateResult = await manageContext({
				messages: this.task.apiConversationHistory,
				totalTokens: contextTokens || 0,
				maxTokens,
				contextWindow,
				apiHandler: this.task.api,
				autoCondenseContext: true,
				autoCondenseContextPercent: FORCED_CONTEXT_REDUCTION_PERCENT,
				systemPrompt: await this.task.requestBuilder.getSystemPrompt(),
				taskId: this.task.taskId,
				profileThresholds,
				currentProfileId,
				metadata,
				environmentDetails,
			})

			if (truncateResult.messages !== this.task.apiConversationHistory) {
				await this.task.overwriteApiConversationHistory(truncateResult.messages)
			}

			if (truncateResult.summary) {
				const { summary, cost, prevContextTokens, newContextTokens = 0 } = truncateResult
				const contextCondense: ContextCondense = { summary, cost, newContextTokens, prevContextTokens }
				await this.task.say(
					"condense_context",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					contextCondense,
				)
			} else if (truncateResult.truncationId) {
				// Sliding window truncation occurred (fallback when condensing fails or is disabled)
				const isCircuitBreaker = /circuit.breaker/i.test(truncateResult.error ?? "")
				const contextTruncation: ContextTruncation = {
					truncationId: truncateResult.truncationId,
					messagesRemoved: truncateResult.messagesRemoved ?? 0,
					prevContextTokens: truncateResult.prevContextTokens,
					newContextTokens: truncateResult.newContextTokensAfterTruncation ?? 0,
					reason: isCircuitBreaker ? "circuit_breaker" : "sliding_window",
				}
				await this.task.say(
					"sliding_window_truncation",
					undefined /* text */,
					undefined /* images */,
					false /* partial */,
					undefined /* checkpoint */,
					undefined /* progressStatus */,
					{ isNonInteractive: true } /* options */,
					undefined /* contextCondense */,
					contextTruncation,
				)
			}
		} finally {
			// Notify webview that context management is complete (removes in-progress spinner)
			// IMPORTANT: Must always be sent to dismiss the spinner, even on error
			await this.task.providerRef
				.deref()
				?.postMessageToWebview({ type: "condenseTaskContextResponse", text: this.task.taskId })
		}
	}

	/**
	 * Build a clean conversation history suitable for API requests.
	 * Handles reasoning blocks (encrypted, plain text, reasoning_details) and
	 * produces a sanitized message array.
	 */
	buildCleanConversationHistory(messages: ApiMessage[]): Array<Anthropic.Messages.MessageParam | ReasoningBlock> {
		type ReasoningItemForRequest = {
			type: "reasoning"
			encrypted_content: string
			id?: string
			summary?: Array<{ type?: string; text?: string }>
		}

		type AssistantMessageWithReasoningDetails = Anthropic.Messages.MessageParam & {
			reasoning_details?: unknown[]
		}

		type AssistantMessageWithReasoningContent = Anthropic.Messages.MessageParam & {
			reasoning_content?: string
		}

		const cleanConversationHistory: (
			| Anthropic.Messages.MessageParam
			| ReasoningItemForRequest
			| AssistantMessageWithReasoningDetails
		)[] = []

		for (const msg of messages) {
			// Standalone reasoning: send encrypted, skip plain text
			if (msg.type === "reasoning") {
				if (msg.encrypted_content) {
					cleanConversationHistory.push({
						type: "reasoning",
						summary: msg.summary,
						encrypted_content: msg.encrypted_content!,
						...(msg.id ? { id: msg.id } : {}),
					})
				}
				continue
			}

			// Preferred path: assistant message with embedded reasoning as first content block
			if (msg.role === "assistant") {
				const rawContent = msg.content

				const contentArray: ContentOrReasoning[] = Array.isArray(rawContent)
					? (rawContent as ContentOrReasoning[])
					: rawContent !== undefined
						? ([
								{ type: "text", text: rawContent } satisfies Anthropic.Messages.TextBlockParam,
							] as ContentOrReasoning[])
						: []

				const [first, ...rest] = contentArray

				// Check if this message has reasoning_details (OpenRouter format for Gemini 3, etc.)
				const msgWithDetails = msg
				if (msgWithDetails.reasoning_details && Array.isArray(msgWithDetails.reasoning_details)) {
					// Build the assistant message with reasoning_details
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (contentArray.length === 0) {
						assistantContent = ""
					} else if (contentArray.length === 1 && contentArray[0]!.type === "text") {
						assistantContent = (contentArray[0]! as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = contentArray as Anthropic.Messages.MessageParam["content"]
					}

					// Create message with reasoning_details property
					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
						reasoning_details: msgWithDetails.reasoning_details,
					})

					continue
				}

				// Embedded reasoning: encrypted (send) or plain text (skip)
				const encryptedReasoningBlock =
					first?.type === "reasoning" && typeof first.encrypted_content === "string" ? first : undefined
				const plainTextReasoningBlock =
					first?.type === "reasoning" && typeof first.text === "string" ? first : undefined

				if (encryptedReasoningBlock) {
					const reasoningBlock = encryptedReasoningBlock

					// Send as separate reasoning item (OpenAI Native)
					cleanConversationHistory.push({
						type: "reasoning",
						summary: reasoningBlock.summary ?? [],
						encrypted_content: reasoningBlock.encrypted_content!,
						...(reasoningBlock.id ? { id: reasoningBlock.id } : {}),
					})

					// Send assistant message without reasoning
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (rest.length === 0) {
						assistantContent = ""
					} else if (rest.length === 1 && rest[0]!.type === "text") {
						assistantContent = (rest[0]! as Anthropic.Messages.TextBlockParam).text
					} else {
						assistantContent = rest as Anthropic.Messages.MessageParam["content"]
					}

					cleanConversationHistory.push({
						role: "assistant",
						content: assistantContent,
					} satisfies Anthropic.Messages.MessageParam)

					continue
				} else if (plainTextReasoningBlock) {
					// Check if the model's preserveReasoning flag is set
					// If true, include the reasoning block in API requests
					// If false/undefined, strip it out (stored for history only, not sent back to API)
					const shouldPreserveForApi = this.task.api.getModel().info.preserveReasoning === true
					let assistantContent: Anthropic.Messages.MessageParam["content"]

					if (shouldPreserveForApi) {
						// Include reasoning block in the content sent to API
						assistantContent = contentArray as Anthropic.Messages.MessageParam["content"]
					} else {
						// Strip reasoning out - stored for history only, not sent back to API
						if (rest.length === 0) {
							assistantContent = ""
						} else if (rest.length === 1 && rest[0]!.type === "text") {
							assistantContent = (rest[0]! as Anthropic.Messages.TextBlockParam).text
						} else {
							assistantContent = rest as Anthropic.Messages.MessageParam["content"]
						}
					}

					// Propagate reasoning_content as a top-level field when present on the
					// stored ApiMessage. DeepSeek / Z.ai require it to be passed back in
					// thinking mode, and convertToR1Format picks it up from the top level.
					const msgWithReasoning = msg as ApiMessage & { reasoning_content?: string }
					const topLevelReasoning = msgWithReasoning.reasoning_content
					if (topLevelReasoning && typeof topLevelReasoning === "string" && topLevelReasoning.trim()) {
						const msgObj: AssistantMessageWithReasoningContent = {
							role: "assistant",
							content: assistantContent,
						}
						// Only set reasoning_content when preserveReasoning signals that the
						// model / provider requires it. Otherwise keep it out of the request.
						if (shouldPreserveForApi) {
							msgObj.reasoning_content = topLevelReasoning
						}
						cleanConversationHistory.push(msgObj)
					} else {
						cleanConversationHistory.push({
							role: "assistant",
							content: assistantContent,
						} satisfies Anthropic.Messages.MessageParam)
					}

					continue
				}
			}

			// Default path for regular messages (no embedded reasoning at first content position)
			if (msg.role) {
				const msgWithReasoning = msg as ApiMessage & { reasoning_content?: string }
				const topLevelReasoning = msgWithReasoning.reasoning_content
				if (topLevelReasoning && typeof topLevelReasoning === "string" && topLevelReasoning.trim()) {
					const shouldPreserveForApi = this.task.api.getModel().info.preserveReasoning === true
					const msgObj: AssistantMessageWithReasoningContent = {
						role: msg.role,
						content: msg.content as Anthropic.Messages.ContentBlockParam[] | string,
					}
					if (shouldPreserveForApi) {
						msgObj.reasoning_content = topLevelReasoning
					}
					cleanConversationHistory.push(msgObj)
				} else {
					cleanConversationHistory.push({
						role: msg.role,
						content: msg.content as Anthropic.Messages.ContentBlockParam[] | string,
					})
				}
			}
		}

		return cleanConversationHistory
	}
}

interface ReasoningBlock {
	type: "reasoning"
	text?: string
	encrypted_content?: string
	id?: string
	summary?: Array<{ type?: string; text?: string }>
}
