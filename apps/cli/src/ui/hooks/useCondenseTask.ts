import { useCallback } from "react"
import type { WebviewMessage } from "@njust-ai/types"

import { useCLIStore } from "../store.js"

/**
 * Hook to request context condensation for the current task.
 *
 * The extension responds with `condenseTaskContextStarted` followed by
 * `condenseTaskContextResponse` when condensation completes or fails.
 */
export function useCondenseTask(sendToExtension: ((msg: WebviewMessage) => void) | null) {
	const { condenseTaskContextInProgress, setCondenseTaskContextInProgress } = useCLIStore()

	const requestCondense = useCallback(() => {
		if (!sendToExtension || condenseTaskContextInProgress) {
			return
		}

		setCondenseTaskContextInProgress(true)
		sendToExtension({ type: "condenseTaskContextRequest" })
	}, [sendToExtension, condenseTaskContextInProgress, setCondenseTaskContextInProgress])

	return {
		condenseTaskContextInProgress,
		requestCondense,
	}
}
