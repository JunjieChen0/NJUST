import { createSignal } from "solid-js"

const [clearSignal, setClearSignal] = createSignal(0)

export function requestPromptClear(): void {
	setClearSignal((n) => n + 1)
}

export function usePromptClearSignal(): () => number {
	return clearSignal
}
