import { ToolDependencyGraph } from "./ToolDependencyGraph"

export type ConcurrentToolExecutorOptions = {
	maxConcurrency?: number
}

export type ConcurrentRunContext = {
	siblingAbortController: AbortController
	signal: AbortSignal
}

export type AbortStrategy = "failFast" | "continueOnError" | "transitiveAbort"

export type ConcurrentRunOptions = {
	/** Abort sibling workers when first task fails */
	failFast?: boolean
	/** Abort strategy for concurrent execution. Takes precedence over failFast when set. */
	abortStrategy?: AbortStrategy
	/**
	 * Dependency graph for transitiveAbort strategy.
	 * When a tool fails, only its transitive dependents are aborted.
	 * If not provided, transitiveAbort falls back to failFast behavior.
	 */
	dependencyGraph?: ToolDependencyGraph
	/**
	 * Map from item index → tool name, used by transitiveAbort to look up
	 * dependencies when a task fails.
	 */
	itemToolNames?: Map<number, string>
}

const DEFAULT_MAX_CONCURRENCY = 10

export class ConcurrentToolExecutor {
	private readonly maxConcurrency: number

	constructor(opts?: ConcurrentToolExecutorOptions) {
		this.maxConcurrency = Math.max(1, opts?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)
	}

	/**
	 * Resolve the effective abort-on-error behavior from the run options.
	 * `abortStrategy` takes precedence; `failFast` is used as a backward-compat fallback.
	 */
	private resolveAbortOnError(opts?: ConcurrentRunOptions): {
		shouldAbortOnError: boolean
		continueOnError: boolean
		useTransitiveAbort: boolean
	} {
		const strategy = opts?.abortStrategy
		if (strategy === "continueOnError") {
			return { shouldAbortOnError: false, continueOnError: true, useTransitiveAbort: false }
		}
		if (strategy === "transitiveAbort") {
			// transitiveAbort: selective abort based on dependency graph
			// Falls back to failFast if no dependency graph is provided
			const hasGraph = opts?.dependencyGraph && !opts.dependencyGraph.isEmpty()
			return {
				shouldAbortOnError: !hasGraph, // failFast fallback if no graph
				continueOnError: false,
				useTransitiveAbort: !!hasGraph,
			}
		}
		if (strategy === "failFast") {
			return { shouldAbortOnError: true, continueOnError: false, useTransitiveAbort: false }
		}
		// Fallback to legacy failFast boolean
		const failFast = opts?.failFast === true
		return { shouldAbortOnError: failFast, continueOnError: false, useTransitiveAbort: false }
	}

	async run<T>(
		items: T[],
		fn: (item: T, index: number, ctx: ConcurrentRunContext) => Promise<void>,
		runOpts?: ConcurrentRunOptions,
	): Promise<void> {
		if (items.length === 0) return
		const workers = Math.min(this.maxConcurrency, items.length)
		let cursor = 0
		const errors: { index: number; error: unknown }[] = []
		const siblingAbortController = new AbortController()
		const { shouldAbortOnError, continueOnError, useTransitiveAbort } = this.resolveAbortOnError(runOpts)

		// For transitiveAbort: track which specific items should be skipped
		const abortedIndices = new Set<number>()

		await Promise.allSettled(
			Array.from({ length: workers }).map(async () => {
				while (true) {
					if (siblingAbortController.signal.aborted && shouldAbortOnError) return
					const idx = cursor++
					if (idx >= items.length) return

					// TransitiveAbort: skip items whose dependencies have failed
					if (useTransitiveAbort && abortedIndices.has(idx)) {
						errors.push({
							index: idx,
							error: new Error(`Skipped: dependency failed (transitive abort)`),
						})
						continue
					}

					try {
						await fn(items[idx], idx, {
							siblingAbortController,
							signal: siblingAbortController.signal,
						})
					} catch (err) {
						errors.push({ index: idx, error: err })

						if (useTransitiveAbort && runOpts?.dependencyGraph && runOpts?.itemToolNames) {
							// Mark transitive dependents for abort
							const failedToolName = runOpts.itemToolNames.get(idx)
							if (failedToolName) {
								const dependents = runOpts.dependencyGraph.getTransitiveDependents(failedToolName)
								// Find indices of dependent tools
								for (const [itemIdx, toolName] of runOpts.itemToolNames.entries()) {
									if (dependents.has(toolName)) {
										abortedIndices.add(itemIdx)
									}
								}
							}
						} else if (shouldAbortOnError && !siblingAbortController.signal.aborted) {
							siblingAbortController.abort(err)
						}
						// continueOnError: just collect the error and keep going
					}
				}
			}),
		)
		if (errors.length > 0) {
			const messages = errors.map(
				(e) => `[item ${e.index}] ${e.error instanceof Error ? e.error.message : String(e.error)}`,
			)
			if (continueOnError) {
				// In continueOnError mode, still throw but include all collected errors
				throw new Error(
					`ConcurrentToolExecutor (continueOnError): ${errors.length} task(s) failed:\n${messages.join("\n")}`,
				)
			}
			throw new Error(`ConcurrentToolExecutor: ${errors.length} task(s) failed:\n${messages.join("\n")}`)
		}
	}
}
