/**
 * Prompt History - JSONL Persistent Storage
 *
 * Stores command history in the shared CLI config directory:
 *   <configDir>/cli-history.json
 *
 * Reuses the existing loadHistory / saveHistory from
 * apps/cli/src/lib/storage/history.ts so file location, error
 * handling, and MAX_HISTORY_ENTRIES stay consistent across the CLI.
 *
 * Two API surfaces:
 *  - usePromptHistory()  - Solid hook returning a reactive store
 *  - PromptHistory       - Plain class with sync add/list/size/search
 *                          (used by legacy perf tests and non-Solid code)
 */

import { createSignal } from "solid-js"
import { loadHistory, saveHistory } from "../../../lib/storage/history.js"

export interface PromptHistoryEntry {
	input: string
	ts: number
}

/**
 * usePromptHistory - Solid hook that returns a reactive history store.
 */
export function usePromptHistory() {
	const [entries, setEntries] = createSignal<string[]>([])

	// Eagerly load existing history (best-effort).
	loadHistory()
		.then((list) => setEntries(list))
		.catch(() => setEntries([]))

	function list(): string[] {
		return entries()
	}

	async function add(input: string): Promise<void> {
		const trimmed = input.trim()
		if (!trimmed) return
		setEntries((prev) => {
			const filtered = prev.filter((e) => e !== trimmed)
			const next = [...filtered, trimmed]
			saveHistory(next).catch(() => {})
			return next
		})
	}

	function clear(): void {
		setEntries([])
		saveHistory([]).catch(() => {})
	}

	function size(): number {
		return entries().length
	}

	return { list, add, clear, size, entries }
}

export type PromptHistoryHook = ReturnType<typeof usePromptHistory>

/**
 * PromptHistory - synchronous class API used by performance tests and any
 * non-reactive caller. Internally mirrors the same JSONL-backed storage
 * so disk state stays in sync.
 */
export class PromptHistory {
	private items: string[]
	private maxSize: number

	constructor(initial: string[] = [], maxSize: number = 1000) {
		this.items = [...initial]
		this.maxSize = maxSize
	}

	add(text: string): void {
		const trimmed = text.trim()
		if (!trimmed) return
		this.items = this.items.filter((e) => e !== trimmed)
		this.items.push(trimmed)
		if (this.items.length > this.maxSize) {
			this.items = this.items.slice(-this.maxSize)
		}
		// Persist in the background.
		saveHistory(this.items).catch(() => {})
	}

	list(): string[] {
		return [...this.items]
	}

	clear(): void {
		this.items = []
		saveHistory([]).catch(() => {})
	}

	size(): number {
		return this.items.length
	}

	get(index: number): string | undefined {
		if (index < 0 || index >= this.items.length) return undefined
		return this.items[index]
	}

	search(query: string): string[] {
		const q = query.toLowerCase()
		return this.items.filter((e) => e.toLowerCase().includes(q))
	}
}
