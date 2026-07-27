import * as vscode from "vscode"
import { z } from "zod"

import { NJUST_AIEventName, type HistoryItem, TelemetryEventName } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"

import { Task } from "../task/Task"
import { ignoreAbortError } from "../../utils/errorHandling"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"
import type { TaskResult } from "../task/SubTaskOptions"

import { wrapAsError, getErrorMessage } from "../../shared/error-utils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { logger } from "../../shared/logger"
import { appendCangjieEvalTrace } from "../../services/CangjieEvalTraceLogger"
import { buildStdModuleEvidenceSuggestions } from "../task/CangjieRuntimePolicy"

interface AttemptCompletionParams {
	result: string
	command?: string
}

const CANGJIE_EVIDENCE_AUDIT_HEADING_RE = /^\s*\**\s*Cangjie evidence audit\s*:?\s*\**\s*$/im
const CANGJIE_COMPLETION_SURFACE_RE =
	/\b(?:Cangjie evidence audit|CangjieCorpus|cjpm|HashMap|Option|std\.collection|std\.regex|File\.readFrom|String\.fromUtf8|MatchData)\b|\.cj\b/i

function hasCangjieEvidenceAuditHeading(result: string): boolean {
	return CANGJIE_EVIDENCE_AUDIT_HEADING_RE.test(result)
}

function normalizeCangjieEvidenceAuditHeading(result: string): string {
	return result.replace(CANGJIE_EVIDENCE_AUDIT_HEADING_RE, "Cangjie evidence audit:")
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	protected override get inputSchema() {
		return z.object({
			result: z.string().min(1, "result is required"),
		})
	}

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		let { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList?.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		const shouldApplyCangjieCompletionGates =
			task.taskMode === "cangjie" ||
			CANGJIE_COMPLETION_SURFACE_RE.test(result) ||
			(await task.cangjieRuntimePolicy.hasCjpmProject())

		if (shouldApplyCangjieCompletionGates) {
			const blockCangjieCompletion = async (reason: string) => {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion", reason)
				await this.traceCangjieCompletion(task, result, "attempt_completion_blocked", reason)
				pushToolResult(formatResponse.toolError(reason))
			}

			const canHandOffPendingBuild =
				!!task.parentTaskId && (task.agentType === "CangjieImplement" || task.agentType === "CangjieRepair")
			const canHandOffFailedBuild = !!task.parentTaskId && task.agentType === "CangjieVerify"
			const completionGateOptions: {
				allowPendingBuild?: boolean
				allowFailedBuildHandoff?: boolean
			} = {}
			if (canHandOffPendingBuild) completionGateOptions.allowPendingBuild = true
			if (canHandOffFailedBuild) completionGateOptions.allowFailedBuildHandoff = true
			const cangjieBlockReason = task.cangjieRuntimePolicy.getAttemptCompletionBlockReason(completionGateOptions)
			if (cangjieBlockReason) {
				await blockCangjieCompletion(cangjieBlockReason)
				return
			}
			const missingCompletionEvidence = task.cangjieRuntimePolicy.getMissingCompletionEvidence(result)
			if (missingCompletionEvidence.length > 0) {
				const evidenceSuggestions = missingCompletionEvidence
					.flatMap((moduleName) =>
						buildStdModuleEvidenceSuggestions(moduleName).map(
							(suggestion) => `- ${moduleName}: ${suggestion}`,
						),
					)
					.join("\n")
				const evidenceSuggestionText = evidenceSuggestions
					? ` Suggested corpus locations:\n${evidenceSuggestions}\n`
					: ""
				const hashMapOptionEvidenceHint =
					missingCompletionEvidence.includes("std.core") &&
					/\bHashMap\b|\.get\s*\(|Option<|\?V\b|Some\(|\bNone\b|getOrDefault|\?\?/i.test(result)
						? " If this is a HashMap.get/counting report, this is not classifying HashMap as std.core: HashMap.get returns ?V/Option<V>, so Option defaults, Some/None, getOrDefault, getOrThrow, or ?? require separate std.core Option evidence. LSP HashMap symbols alone do not satisfy std.core Option evidence; cite CangjieCorpus-1.0.0/extra/Option.md or libs/std/core/core_package_api/core_package_enums.md."
						: ""
				const errorMsg =
					`Completion blocked in Cangjie mode: the final answer asserts or evaluates high-risk stdlib API usage without external evidence for ${missingCompletionEvidence.join(", ")}. ` +
					hashMapOptionEvidenceHint +
					evidenceSuggestionText +
					`Preloaded prompt snippets and built-in signature hints do not count as evidence. Before claiming the API usage is correct, use external evidence such as the bundled CangjieCorpus or LSP hover/definition. ` +
					`If the user explicitly prohibited corpus search, LSP, file reads, or evidence lookup, do not perform those actions to satisfy this gate; report that the API correctness cannot be claimed or the task is blocked/inconclusive under the user's constraints. ` +
					`Chinese directive: 如果用户说“不要查语料库”、“不要查 CangjieCorpus”、“不要查 LSP”、“不要读取文件”或“不要找证据”，不要为了通过这个门禁去调用这些工具；只能说明在该限制下不能确认 API 正确性。`
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion", errorMsg)
				await this.traceCangjieCompletion(task, result, "attempt_completion_blocked", errorMsg)
				pushToolResult(formatResponse.toolError(errorMsg))
				return
			}
			const unsupportedRiskSpeculation = task.cangjieRuntimePolicy.getUnsupportedStdlibRiskSpeculation?.(result)
			if (unsupportedRiskSpeculation) {
				await blockCangjieCompletion(unsupportedRiskSpeculation)
				return
			}
			const contextInjectionAuditMissingLabelsReport =
				task.cangjieRuntimePolicy.getContextInjectionAuditMissingLabelsReport?.(result)
			if (contextInjectionAuditMissingLabelsReport) {
				await blockCangjieCompletion(contextInjectionAuditMissingLabelsReport)
				return
			}
			const contextInjectionAuditScopeReport =
				task.cangjieRuntimePolicy.getContextInjectionAuditScopeReport?.(result)
			if (contextInjectionAuditScopeReport) {
				await blockCangjieCompletion(contextInjectionAuditScopeReport)
				return
			}
			const contradictoryVerificationReport =
				task.cangjieRuntimePolicy.getContradictoryVerificationReport?.(result)
			if (contradictoryVerificationReport) {
				await blockCangjieCompletion(contradictoryVerificationReport)
				return
			}
			const allowlistExtraProbeReport = task.cangjieRuntimePolicy.getAllowlistExtraProbeReport?.(result)
			if (allowlistExtraProbeReport) {
				await blockCangjieCompletion(allowlistExtraProbeReport)
				return
			}
			const invalidOptionDefaultCallReport = task.cangjieRuntimePolicy.getInvalidOptionDefaultCallReport?.(result)
			if (invalidOptionDefaultCallReport) {
				await blockCangjieCompletion(invalidOptionDefaultCallReport)
				return
			}
			const unsafeHashMapCountGetOrThrowReport =
				task.cangjieRuntimePolicy.getUnsafeHashMapCountGetOrThrowReport?.(result)
			if (unsafeHashMapCountGetOrThrowReport) {
				await blockCangjieCompletion(unsafeHashMapCountGetOrThrowReport)
				return
			}
			const incorrectRegexFindSignatureReport =
				task.cangjieRuntimePolicy.getIncorrectRegexFindSignatureReport?.(result)
			if (incorrectRegexFindSignatureReport) {
				await blockCangjieCompletion(incorrectRegexFindSignatureReport)
				return
			}
			const evidenceReportInvitationReport = task.cangjieRuntimePolicy.getEvidenceReportInvitationReport?.(result)
			if (evidenceReportInvitationReport) {
				await blockCangjieCompletion(evidenceReportInvitationReport)
				return
			}
			const uncitedHashMapSubscriptAssignmentReport =
				task.cangjieRuntimePolicy.getUncitedHashMapSubscriptAssignmentReport?.(result)
			if (uncitedHashMapSubscriptAssignmentReport) {
				await blockCangjieCompletion(uncitedHashMapSubscriptAssignmentReport)
				return
			}
			const unsupportedHashMapMutabilityClaimReport =
				task.cangjieRuntimePolicy.getUnsupportedHashMapMutabilityClaimReport?.(result)
			if (unsupportedHashMapMutabilityClaimReport) {
				await blockCangjieCompletion(unsupportedHashMapMutabilityClaimReport)
				return
			}
			const evidenceAudit = task.cangjieRuntimePolicy.getEvidenceAuditSummary?.()
			if (evidenceAudit && hasCangjieEvidenceAuditHeading(result)) {
				result = normalizeCangjieEvidenceAuditHeading(result)
			} else if (evidenceAudit) {
				result = `${result.trim()}\n\n${evidenceAudit}`
			}

			await this.traceCangjieCompletion(task, result, "attempt_completion")
		}

		try {
			task.consecutiveMistakeCount = 0

			await task.say("completion_result", result, undefined, false)

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegation = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegation === "delegated") {
								this.emitTaskCompleted(task)
							}
							if (delegation !== "continue") return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							logger.error(
								"AttemptCompletionTool",
								`Unexpected child task status "${status}" for task ${task.taskId}. Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						logger.error(
							"AttemptCompletionTool",
							`Failed to get history for task ${task.taskId}: ${getErrorMessage(err)}. Skipping delegation.`,
						)
						TelemetryService.reportError(
							err instanceof Error ? err : new Error(String(err)),
							TelemetryEventName.UTILITY_ERROR,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			// MemRL: the agent has declared the task done by invoking attempt_completion.
			// Record this as the success signal regardless of the user's approval action.
			task.markAttemptedCompletion()

			// Cangjie completion gates and agent-route validation have already passed.
			// Waiting for a second UI acknowledgement here causes unattended tasks to
			// time out and resubmit attempt_completion indefinitely.
			if (task.taskMode === "cangjie" && !task.parentTaskId) {
				this.emitTaskCompleted(task)
				return
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				this.emitTaskCompleted(task)
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `[USER-MESSAGE]\n${text}\n[END USER-MESSAGE]`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("completing task", wrapAsError(error))
		}
	}

	private async traceCangjieCompletion(
		task: Task,
		result: string,
		stage: "attempt_completion" | "attempt_completion_blocked",
		blockReason?: string,
	): Promise<void> {
		try {
			await appendCangjieEvalTrace({
				globalStoragePath: task.globalStoragePath,
				taskId: task.taskId,
				rootTaskId: task.rootTaskId,
				parentTaskId: task.parentTaskId,
				cwd: task.cwd,
				mode: task.taskMode,
				stage,
				result,
				blockReason,
				toolUsage: task.toolUsage,
				runtimeSnapshot: task.cangjieRuntimePolicy.getEvalRuntimeSnapshot(),
				taskText: task.rootTask?.metadata?.task ?? task.metadata?.task,
			})
		} catch (error) {
			logger.warn("AttemptCompletionTool", `Failed to write Cangjie eval trace: ${getErrorMessage(error)}`)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated" when completion was approved and parent resumed
	 * - "denied" when user denied finishing the subtask
	 * - "continue" when caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "denied" | "continue"> {
		const isBuiltInCangjieSubtask = !!task.parentTaskId && !!task.agentType?.startsWith("Cangjie")
		const didApprove = isBuiltInCangjieSubtask || (await askFinishSubTaskApproval())

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		pushToolResult("")

		// For forked tasks, build a structured result summary with file info
		let completionResultSummary = result
		if (task.isolationLevel === "forked") {
			const taskResult: TaskResult = {
				success: true,
				summary: result,
				isolationLevel: "forked",
			}
			completionResultSummary = `[Forked Sub-task Result]\n${JSON.stringify(taskResult, null, 2)}`
		}

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary,
		})

		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(ignoreAbortError)
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(ignoreAbortError)
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private emitTaskCompleted(task: Task): void {
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()

		TelemetryService.instance.captureTaskCompleted(task.taskId)
		task.emit(NJUST_AIEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage, {
			isSubtask: !!task.parentTaskId,
		})

		// Signal the outer loop to stop re-prompting the model with
		// noToolsUsed() after the user accepts this completion.
		task.markTaskCompleted()
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
