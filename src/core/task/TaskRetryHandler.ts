import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiStream } from "../../api/transform/stream"
import type { TaskExecutorHost } from "./interfaces/ITaskExecutorHost"
import { TaskState } from "./TaskStateMachine"
import { getErrorMessage } from "../../shared/error-utils"
import { logger } from "../../shared/logger"
import { TaskAbortedError, TaskApiRequestError, TaskModelPreparationError, TaskRetryExhaustedError } from "./TaskErrors"
import { analyzeErrorForRetry, redactErrorForTelemetry } from "../../api/retry/ApiErrorClassifier"
import { computeBackoffMs, DEFAULT_API_RETRY_OPTIONS, delayMs } from "../../api/retry/ApiRetryStrategy"

interface RetryApiRequest {
	(retryAttempt?: number, options?: { skipProviderRateLimit?: boolean }): ApiStream
}

export async function* handleAttemptApiRequestError(options: {
	host: TaskExecutorHost
	error: unknown
	retryAttempt: number
	autoApprovalEnabled: boolean | undefined
	unattendedRetryEnabled: boolean
	unattendedMaxRetryAttempts: number
	retryApiRequest: RetryApiRequest
	phase?: "model_preparation"
	signal?: AbortSignal
}): ApiStream {
	const {
		host,
		error,
		retryAttempt,
		autoApprovalEnabled,
		unattendedRetryEnabled,
		unattendedMaxRetryAttempts,
		retryApiRequest,
	} = options

	host.isWaitingForFirstChunk = false
	if (options.phase !== "model_preparation") host.currentRequestAbortController = undefined

	if (host.abort) {
		host.stateMachine.force(TaskState.ERROR)
		throw new TaskAbortedError(host.taskId, host.instanceId)
	}
	if (options.phase === "model_preparation") {
		const decision = analyzeErrorForRetry(error)
		const maxRetries = unattendedRetryEnabled ? Math.max(0, Math.min(2, unattendedMaxRetryAttempts)) : 2
		const message = `Model preparation failed: ${redactErrorForTelemetry(error)}`
		let nextAttempt: number
		try {
			if (options.signal?.aborted || host.abandoned) throw new TaskAbortedError(host.taskId, host.instanceId)
			if (autoApprovalEnabled && decision.shouldRetry && retryAttempt < maxRetries) {
				const waitMs = computeBackoffMs(retryAttempt, DEFAULT_API_RETRY_OPTIONS, decision.retryAfterSeconds)
				await host.say(
					"api_req_retry_delayed",
					`${message}\n<retry_timer>${Math.ceil(waitMs / 1000)}</retry_timer>`,
					undefined,
					true,
				)
				await delayMs(waitMs, options.signal)
				await host.say("api_req_retry_delayed", message, undefined, false)
				nextAttempt = retryAttempt + 1
			} else {
				host.stateMachine.force(TaskState.ERROR)
				if (host.currentRequestAbortController?.signal === options.signal)
					host.currentRequestAbortController = undefined
				const { response } = await host.ask("api_req_failed", message)
				if (response !== "yesButtonClicked") throw new TaskModelPreparationError(message, error)
				await host.say("api_req_retried")
				nextAttempt = 0
			}
			if (host.abort || host.abandoned || options.signal?.aborted)
				throw new TaskAbortedError(host.taskId, host.instanceId)
		} catch (recoveryError) {
			logger.debug("TaskRetryHandler", "Model preparation recovery ended", redactErrorForTelemetry(recoveryError))
			if (host.abort || host.abandoned || options.signal?.aborted || recoveryError instanceof TaskAbortedError)
				throw new TaskAbortedError(host.taskId, host.instanceId)
			if (recoveryError instanceof TaskModelPreparationError) throw recoveryError
			throw new TaskModelPreparationError(message, recoveryError)
		}
		yield* retryApiRequest(nextAttempt)
		return
	}

	const persistentRetryHandler =
		host.persistentRetryHandler ??
		(host.persistentRetryHandler = new (await import("./PersistentRetry")).PersistentRetryManager())

	const recovery = await host.errorRecovery.handleApiError(error, retryAttempt)
	if (recovery.action === "retry") {
		yield* retryApiRequest(recovery.nextAttempt)
		return
	}

	if (autoApprovalEnabled && analyzeErrorForRetry(error).shouldRetry) {
		host.stateMachine.force(TaskState.RECOVERING_MAX_TOKENS)
		if (unattendedRetryEnabled && retryAttempt >= unattendedMaxRetryAttempts) {
			const { classifyApiError } = await import("../errors/apiErrorClassifier")
			const errorType = classifyApiError(error)
			if (persistentRetryHandler.isEligible(errorType)) {
				const taskHost = host.hostRef.deref()
				if (taskHost?.log) {
					taskHost.log(
						`[Task#${host.taskId}] Normal retry limit reached. Entering persistent retry for ${errorType}...`,
					)
				}
				try {
					await persistentRetryHandler.waitForRetry(errorType, (message, _retryCount, _elapsed) => {
						void host.say("api_req_retry_delayed", message, undefined, true)
					})
				} catch (persistentErr) {
					logger.debug("TaskRetryHandler", "Persistent retry stopped", redactErrorForTelemetry(persistentErr))
					if (host.abort || host.abandoned) throw new TaskAbortedError(host.taskId, host.instanceId)
					const stats = persistentRetryHandler.getStats()
					throw new TaskApiRequestError(
						`[Task#${host.taskId}] Persistent retry ended after ${stats.totalRetries} attempts: ${getErrorMessage(persistentErr)}`,
						persistentErr,
					)
				}

				if (host.abort) {
					persistentRetryHandler.cancel()
					throw new TaskAbortedError(host.taskId, host.instanceId)
				}

				yield* retryApiRequest(retryAttempt + 1)
				return
			}

			throw new TaskRetryExhaustedError(host.taskId, unattendedMaxRetryAttempts)
		}

		await host.streamProcessor.backoffAndAnnounce(retryAttempt, error)
		if (host.abort) {
			throw new TaskAbortedError(host.taskId, host.instanceId)
		}

		yield* retryApiRequest(retryAttempt + 1)
		return
	}

	host.stateMachine.force(TaskState.ERROR)
	try {
		const { response } = await host.ask("api_req_failed", getErrorMessage(error))
		if (response !== "yesButtonClicked") throw new TaskApiRequestError("API request failed", error)
	} catch (recoveryError) {
		logger.debug("TaskRetryHandler", "API recovery ended", redactErrorForTelemetry(recoveryError))
		if (host.abort || host.abandoned) throw new TaskAbortedError(host.taskId, host.instanceId)
		if (recoveryError instanceof TaskApiRequestError) throw recoveryError
		throw new TaskApiRequestError("API request failed", recoveryError)
	}
	if (host.abort || host.abandoned) throw new TaskAbortedError(host.taskId, host.instanceId)
	await host.say("api_req_retried")
	yield* retryApiRequest()
}

export async function handleMidStreamFailure(options: {
	task: TaskExecutorHost
	error: unknown
	currentRetryAttempt: number
	currentUserContent: Anthropic.Messages.ContentBlockParam[]
	stack: Array<{
		userContent: Anthropic.Messages.ContentBlockParam[]
		includeFileDetails: boolean
		retryAttempt?: number
		userMessageWasRemoved?: boolean
	}>
	streamingFailedMessage?: string
	abortStream(cancelReason: "user_cancelled" | "streaming_failed", streamingFailedMessage?: string): Promise<void>
}): Promise<"continue" | "break" | "handled"> {
	const { task, error, currentRetryAttempt, currentUserContent, stack, streamingFailedMessage, abortStream } = options

	if (task.abandoned) {
		return "handled"
	}
	const cancelReason = task.abort || error instanceof TaskAbortedError ? "user_cancelled" : "streaming_failed"
	await abortStream(cancelReason, cancelReason === "user_cancelled" ? undefined : streamingFailedMessage)

	if (task.abort) {
		task.abortReason = cancelReason
		await task.abortTask()
		return "break"
	}
	if (
		error instanceof TaskModelPreparationError ||
		error instanceof TaskApiRequestError ||
		error instanceof TaskRetryExhaustedError ||
		error instanceof TaskAbortedError
	)
		throw error
	if (!analyzeErrorForRetry(error).shouldRetry) {
		const { response } = await task.ask("api_req_failed", getErrorMessage(error))
		if (response !== "yesButtonClicked") throw new TaskApiRequestError("API request failed", error)
		if (task.abort || task.abandoned) throw new TaskAbortedError(task.taskId, task.instanceId)
		await task.say("api_req_retried")
	}

	logger.error(
		"TaskExecutor",
		`Stream failed for task ${task.taskId}.${task.instanceId}, will retry: ${streamingFailedMessage}`,
	)

	const stateForBackoff = await task.hostRef.deref()?.getState()
	if (stateForBackoff?.autoApprovalEnabled && analyzeErrorForRetry(error).shouldRetry) {
		await task.backoffAndAnnounce(currentRetryAttempt, error)
		if (task.abort) {
			logger.info(
				"TaskExecutor",
				`Task aborted during mid-stream retry backoff for task ${task.taskId}.${task.instanceId}`,
			)
			task.abortReason = "user_cancelled"
			await task.abortTask()
			return "break"
		}
	}

	stack.push({
		userContent: currentUserContent,
		includeFileDetails: false,
		retryAttempt: currentRetryAttempt + 1,
	})

	return "continue"
}

export async function handleEmptyAssistantResponse(options: {
	task: TaskExecutorHost
	currentRetryAttempt: number
	currentUserContent: Anthropic.Messages.ContentBlockParam[]
	stack: Array<{
		userContent: Anthropic.Messages.ContentBlockParam[]
		includeFileDetails: boolean
		retryAttempt?: number
		userMessageWasRemoved?: boolean
	}>
}): Promise<"continue" | "break" | "done"> {
	const { task, currentRetryAttempt, currentUserContent, stack } = options

	task.consecutiveNoAssistantMessagesCount++
	if (task.consecutiveNoAssistantMessagesCount >= 2) {
		await task.say("error", "MODEL_NO_ASSISTANT_MESSAGES")
	}

	const state = await task.hostRef.deref()?.getState()
	if (task.apiConversationHistory.length > 0) {
		const lastMessage = task.apiConversationHistory[task.apiConversationHistory.length - 1]
		if (lastMessage?.role === "user") {
			task.apiConversationHistory.pop()
		}
	}

	if (state?.autoApprovalEnabled) {
		await task.backoffAndAnnounce(
			currentRetryAttempt,
			new Error(
				"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
			),
		)

		if (task.abort) {
			logger.info(
				"TaskExecutor",
				`Task aborted during empty-assistant retry backoff for task ${task.taskId}.${task.instanceId}`,
			)
			return "break"
		}

		stack.push({
			userContent: currentUserContent,
			includeFileDetails: false,
			retryAttempt: currentRetryAttempt + 1,
			userMessageWasRemoved: true,
		})

		return "continue"
	}

	const { response } = await task.ask(
		"api_req_failed",
		"The model returned no assistant messages. This may indicate an issue with the API or the model's output.",
	)

	if (response === "yesButtonClicked") {
		await task.say("api_req_retried")
		stack.push({
			userContent: currentUserContent,
			includeFileDetails: false,
			retryAttempt: currentRetryAttempt + 1,
		})
		return "continue"
	}

	await task.addToApiConversationHistory({
		role: "user",
		content: currentUserContent,
	})

	await task.say(
		"error",
		"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
	)

	await task.addToApiConversationHistory({
		role: "assistant",
		content: [{ type: "text", text: "Failure: I did not provide a response." }],
	})

	return "done"
}
