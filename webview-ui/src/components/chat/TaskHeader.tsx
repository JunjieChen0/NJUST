import { memo, useRef, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronUp, ChevronDown, HardDriveDownload, HardDriveUpload, FoldVertical, ArrowLeft } from "lucide-react"
import prettyBytes from "pretty-bytes"

import type { ClineMessage } from "@njust-ai-cj/types"

import { getModelMaxOutputTokens } from "@roo/api"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { StandardTooltip, Button, Table, TableBody, TableRow, TableCell, CircularProgress } from "@src/components/ui"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { vscode } from "@src/utils/vscode"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "./TaskActions"
import { ContextWindowProgress } from "./ContextWindowProgress"
import { Mention } from "./Mention"
import { TodoListDisplay } from "./TodoListDisplay"
import { LucideIconButton } from "./LucideIconButton"

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	parentTaskId?: string
	costBreakdown?: string
	contextTokens: number
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
	todos?: any[]
}

const TaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	aggregatedCost,
	hasSubtasks,
	parentTaskId,
	costBreakdown,
	contextTokens,
	buttonsDisabled,
	handleCondenseContext,
	todos,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration, currentTaskItem, clineMessages: _clineMessages, latestTaskMetrics, taskMetricsHistory } = useExtensionState()
	const { id: modelId, info: model } = useSelectedModel(apiConfiguration)
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = model?.contextWindow || 1

	// Calculate maxTokens (reserved for output) once for reuse in percentage and tooltip
	const maxTokens = useMemo(
		() =>
			model
				? getModelMaxOutputTokens({
						modelId,
						model,
						settings: apiConfiguration,
					})
				: 0,
		[model, modelId, apiConfiguration],
	)
	const reservedForOutput = maxTokens || 0

	const currentTaskMetricsHistory = (taskMetricsHistory ?? []).filter((m) => m.taskId === currentTaskItem?.id)
	const metricsSummary = (() => {
		if (currentTaskMetricsHistory.length === 0) return undefined
		const n = currentTaskMetricsHistory.length
		const avgCacheHitRate =
			currentTaskMetricsHistory.reduce((sum, m) => sum + m.cacheHitRate, 0) / n
		const avgSavings =
			currentTaskMetricsHistory.reduce((sum, m) => sum + m.estimatedSavingsPercent, 0) / n
		const avgLatencyMs =
			currentTaskMetricsHistory.reduce((sum, m) => sum + m.latencyMs, 0) / n
		const totalInput = currentTaskMetricsHistory.reduce((sum, m) => sum + m.inputTokens, 0)
		const totalOutput = currentTaskMetricsHistory.reduce((sum, m) => sum + m.outputTokens, 0)
		return {
			avgCacheHitRate,
			avgSavings,
			avgLatencyMs,
			totalInput,
			totalOutput,
			samples: n,
		}
	})()
	const sparklinePath = (() => {
		if (currentTaskMetricsHistory.length < 2) return ""
		const values = currentTaskMetricsHistory.slice(-12).map((m) => Math.max(0, Math.min(100, m.cacheHitRate * 100)))
		const width = 72
		const height = 14
		const step = values.length > 1 ? width / (values.length - 1) : width
		return values
			.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - (v / 100) * height).toFixed(1)}`)
			.join(" ")
	})()

	const condenseButton = (
		<LucideIconButton
			title={t("chat:task.condenseContext")}
			icon={FoldVertical}
			disabled={buttonsDisabled}
			onClick={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
		/>
	)

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	// Determine if this is a subtask (has a parent)
	const isSubtask = !!parentTaskId

	const handleBackToParent = () => {
		if (parentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentTaskId })
		}
	}

	const showMetricsCard = latestTaskMetrics?.taskId === currentTaskItem?.id

	return (
		<div className="group pt-2 pb-0 px-3">
			{isSubtask && (
				<div className="mb-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleBackToParent}
						className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
						<ArrowLeft className="size-3" />
						{t("chat:task.backToParentTask")}
					</Button>
				</div>
			)}
			<div
				className={cn(
					"px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer",
					"bg-vscode-input-background hover:bg-vscode-input-background/90",
					"text-vscode-foreground/80 hover:text-vscode-foreground",
					"shadow-lg shadow-vscode-sideBar-background/50 rounded-xl",
					hasTodos && "border-b-0",
				)}
				onClick={(e) => {
					// Don't expand if clicking on todos section
					if (e.target instanceof Element && e.target.closest("[data-todo-list]")) {
						return
					}

					// Don't expand if clicking on buttons or interactive elements
					if (
						e.target instanceof Element &&
						(e.target.closest("button") ||
							e.target.closest('[role="button"]') ||
							e.target.closest(".share-button") ||
							e.target.closest("[data-radix-popper-content-wrapper]") ||
							e.target.closest("img") ||
							e.target.tagName === "IMG")
					) {
						return
					}

					// Don't expand/collapse if user is selecting text
					const selection = window.getSelection()
					if (selection && selection.toString().length > 0) {
						return
					}

					setIsTaskExpanded(!isTaskExpanded)
				}}>
				<div className="flex justify-between items-center gap-0">
					<div className="flex items-center select-none grow min-w-0">
						<div className="grow min-w-0">
							{isTaskExpanded && <span className="font-bold">{t("chat:task.title")}</span>}
							{!isTaskExpanded && (
								<div className="flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
									<Mention text={task.text} />
								</div>
							)}
						</div>
						<div className="flex items-center shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
							<StandardTooltip content={isTaskExpanded ? t("chat:task.collapse") : t("chat:task.expand")}>
								<button
									onClick={() => setIsTaskExpanded(!isTaskExpanded)}
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-85 hover:opacity-100 bg-transparent border-none rounded-md">
									{isTaskExpanded ? (
										<ChevronUp size={16} />
									) : (
										<ChevronDown size={16} className="opacity-0 group-hover:opacity-100" />
									)}
								</button>
							</StandardTooltip>
						</div>
					</div>
				</div>
				{showMetricsCard && latestTaskMetrics && (
					<div
						className="flex items-center gap-3 text-xs px-2 py-1 rounded-md bg-vscode-editor-background border border-vscode-panel-border"
						onClick={(e) => e.stopPropagation()}>
						<span>Cache hit: {(latestTaskMetrics.cacheHitRate * 100).toFixed(1)}%</span>
						<span>Saved: {latestTaskMetrics.estimatedSavingsPercent.toFixed(1)}%</span>
						<span>Latency: {latestTaskMetrics.latencyMs}ms</span>
					</div>
				)}
				{!isTaskExpanded && contextWindow > 0 && (
					<div
						className="flex items-center justify-between text-sm text-muted-foreground/70"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center gap-2">
							<StandardTooltip
								content={(() => {
									const availableSpace = contextWindow - (contextTokens || 0) - reservedForOutput

									return (
										<Table className="text-base ml-1.5">
											<TableBody>
												<TableRow>
													<TableCell className="font-medium whitespace-nowrap">
														{t("chat:tokenProgress.tokensUsedLabel")}
													</TableCell>
													<TableCell className="text-right text-[0.9em] font-mono">
														{formatLargeNumber(contextTokens || 0)} /{" "}
														{formatLargeNumber(contextWindow)}
													</TableCell>
												</TableRow>
												{reservedForOutput > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.reservedForResponseLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(reservedForOutput)}
														</TableCell>
													</TableRow>
												)}
												{availableSpace > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.availableSpaceLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(availableSpace)}
														</TableCell>
													</TableRow>
												)}
											</TableBody>
										</Table>
									)
								})()}
								side="top"
								sideOffset={8}>
								<span className="flex items-center gap-1.5">
									{(() => {
										// Calculate percentage of available input space used
										// Available input space = context window - reserved for output
										const availableInputSpace = contextWindow - reservedForOutput
										const percentage =
											availableInputSpace > 0
												? Math.round(((contextTokens || 0) / availableInputSpace) * 100)
												: 0
										return (
											<>
												<CircularProgress percentage={percentage} />
												<span>{percentage}%</span>
											</>
										)
									})()}
								</span>
							</StandardTooltip>
							{showMetricsCard && latestTaskMetrics && (
								<>
									<span>·</span>
									<span title="Prompt cache hit rate">Cache {Math.round(latestTaskMetrics.cacheHitRate * 100)}%</span>
									<span title="Estimated cache savings">Saved {latestTaskMetrics.estimatedSavingsPercent.toFixed(1)}%</span>
									<span title="Latest request latency">{latestTaskMetrics.latencyMs}ms</span>
									{typeof latestTaskMetrics.contextPercent === "number" && (
										<span title="Current context window usage">Ctx {latestTaskMetrics.contextPercent.toFixed(0)}%</span>
									)}
									{typeof latestTaskMetrics.compactLikelyTriggered === "boolean" && latestTaskMetrics.compactLikelyTriggered && (
										<span title="Context manager likely to compact soon">Compact↑</span>
									)}
									{sparklinePath && (
										<svg width="72" height="14" viewBox="0 0 72 14" aria-label="cache-hit-rate-trend">
											<path d={sparklinePath} fill="none" stroke="currentColor" strokeWidth="1.25" />
										</svg>
									)}
									{metricsSummary && (
										<>
											<span title={`samples=${metricsSummary.samples}`}>AvgCache {Math.round(metricsSummary.avgCacheHitRate * 100)}%</span>
											<span title="Average estimated cache savings">AvgSaved {metricsSummary.avgSavings.toFixed(1)}%</span>
											<span title="Average request latency">AvgLatency {Math.round(metricsSummary.avgLatencyMs)}ms</span>
										</>
									)}
								</>
							)}
							{!!totalCost && (
								<>
									<span>·</span>
									<StandardTooltip
										content={
											hasSubtasks ? (
												<div>
													<div>
														{t("chat:costs.totalWithSubtasks", {
															cost: (aggregatedCost ?? totalCost).toFixed(2),
														})}
													</div>
													{costBreakdown && (
														<div className="text-xs mt-1">{costBreakdown}</div>
													)}
												</div>
											) : (
												<div>{t("chat:costs.total", { cost: totalCost.toFixed(2) })}</div>
											)
										}
										side="top"
										sideOffset={8}>
										<>
											<span>
												${(aggregatedCost ?? totalCost).toFixed(2)}
												{hasSubtasks && (
													<span
														className="text-xs ml-1"
														title={t("chat:costs.includesSubtasks")}>
														*
													</span>
												)}
											</span>
										</>
									</StandardTooltip>
								</>
							)}
						</div>
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere cursor-text py-0.5"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								<Mention text={task.text} />
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div onClick={(e) => e.stopPropagation()}>
							<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
						</div>

						<div className="pt-3 mt-2 -mx-2.5 px-2.5 border-t border-vscode-sideBar-background">
							<table className="w-full text-sm">
								<tbody>
									{contextWindow > 0 && (
										<tr>
											<th
												className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]"
												data-testid="context-window-label">
												{t("chat:task.contextWindow")}
											</th>
											<td className="font-light align-top">
												<div className={`max-w-md -mt-1.5 flex flex-nowrap gap-1`}>
													<ContextWindowProgress
														contextWindow={contextWindow}
														contextTokens={contextTokens || 0}
														maxTokens={maxTokens || undefined}
													/>
													{condenseButton}
												</div>
											</td>
										</tr>
									)}

									<tr>
										<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
											{t("chat:task.tokens")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 flex-wrap">
												{typeof tokensIn === "number" && tokensIn > 0 && (
													<span>↑ {formatLargeNumber(tokensIn)}</span>
												)}
												{typeof tokensOut === "number" && tokensOut > 0 && (
													<span>↓ {formatLargeNumber(tokensOut)}</span>
												)}
											</div>
										</td>
									</tr>

									{((typeof cacheReads === "number" && cacheReads > 0) ||
										(typeof cacheWrites === "number" && cacheWrites > 0)) && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.cache")}
											</th>
											<td className="font-light align-top">
												<div className="flex items-center gap-1 flex-wrap">
													{typeof cacheWrites === "number" && cacheWrites > 0 && (
														<>
															<HardDriveDownload className="size-2.5" />
															<span>{formatLargeNumber(cacheWrites)}</span>
														</>
													)}
													{typeof cacheReads === "number" && cacheReads > 0 && (
														<>
															<HardDriveUpload className="size-2.5" />
															<span>{formatLargeNumber(cacheReads)}</span>
														</>
													)}
												</div>
											</td>
										</tr>
									)}

									{!!totalCost && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.apiCost")}
											</th>
											<td className="font-light align-top">
												<StandardTooltip
													content={
														hasSubtasks ? (
															<div>
																<div>
																	{t("chat:costs.totalWithSubtasks", {
																		cost: (aggregatedCost ?? totalCost).toFixed(2),
																	})}
																</div>
																{costBreakdown && (
																	<div className="text-xs mt-1">{costBreakdown}</div>
																)}
															</div>
														) : (
															<div>
																{t("chat:costs.total", { cost: totalCost.toFixed(2) })}
															</div>
														)
													}
													side="top"
													sideOffset={8}>
													<span>
														${(aggregatedCost ?? totalCost).toFixed(2)}
														{hasSubtasks && (
															<span
																className="text-xs ml-1"
																title={t("chat:costs.includesSubtasks")}>
																*
															</span>
														)}
													</span>
												</StandardTooltip>
											</td>
										</tr>
									)}

									{/* Size display */}
									{!!currentTaskItem?.size && currentTaskItem.size > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-2 h-[20px]">
												{t("chat:task.size")}
											</th>
											<td className="font-light align-top">
												{prettyBytes(currentTaskItem.size)}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</>
				)}
				{/* Todo list - always shown at bottom when todos exist */}
				{hasTodos && <TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />}
			</div>
		</div>
	)
}

export default memo(TaskHeader)
