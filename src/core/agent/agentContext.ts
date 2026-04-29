/**
 * Agent Context Isolation via AsyncLocalStorage
 *
 * When multiple agents run concurrently (foreground + background), shared
 * module-level state (AppState, caches, etc.) can be corrupted. This module
 * uses Node.js AsyncLocalStorage to track agent identity across async
 * boundaries without parameter drilling.
 *
 * Inspired by Claude Code's agentContext.ts.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface AgentContextData {
	/** Unique agent identifier */
	agentId: string
	/** Agent type name */
	agentType: string
	/** Parent agent ID (undefined for main agent) */
	parentAgentId?: string
	/** Task ID this agent is executing */
	taskId: string
	/** Whether this agent is running in the background */
	isBackground?: boolean
	/** Agent depth in the delegation chain */
	depth: number
	/** Timestamp when the agent started */
	startedAt: number
}

const agentStorage = new AsyncLocalStorage<AgentContextData>()

/**
 * Run a function within the context of a specific agent.
 * All synchronous and asynchronous operations within the callback
 * (and their continuations) can access the agent context via getAgentContext().
 */
export function runWithAgentContext<T>(context: AgentContextData, fn: () => T | Promise<T>): T | Promise<T> {
	const result = agentStorage.run(context, fn)
	return result
}

/** Get the current agent context, or undefined if not within an agent context */
export function getAgentContext(): AgentContextData | undefined {
	return agentStorage.getStore()
}

/** Get the current agent ID, or "root" if no agent context is active */
export function getCurrentAgentId(): string {
	return agentStorage.getStore()?.agentId ?? "root"
}

/** Get the current agent type, or "default" if no agent context is active */
export function getCurrentAgentType(): string {
	return agentStorage.getStore()?.agentType ?? "default"
}

/** Check if we're running inside a background agent */
export function isBackgroundAgent(): boolean {
	return agentStorage.getStore()?.isBackground ?? false
}

/** Check if we're running inside a fork child (depth > 0) */
export function isForkChild(): boolean {
	return (agentStorage.getStore()?.depth ?? 0) > 0
}
