import { useCallback } from "react"
import type { WebviewMessage } from "@njust-ai/types"
import { spawn } from "child_process"

import { useCLIStore } from "../store.js"

/**
 * Hook to perform checkpoint diff/restore actions.
 *
 * Diff is shown by spawning an external tool:
 * - `code --diff` if available
 * - `git diff` in the workspace as fallback
 *
 * Restore requests confirmation before sending the message to the extension.
 */
export function useCheckpoints(sendToExtension: ((msg: WebviewMessage) => void) | null, workspacePath: string) {
	const { currentCheckpoint } = useCLIStore()

	const showDiff = useCallback(
		async (mode: "full" | "checkpoint" | "from-init" | "to-current") => {
			if (!currentCheckpoint || !sendToExtension) {
				return
			}

			sendToExtension({
				type: "checkpointDiff",
				payload: {
					ts: currentCheckpoint.ts,
					commitHash: currentCheckpoint.commitHash,
					mode,
				},
			})

			// Try VS Code diff first; fall back to git diff pager.
			const code = spawn("code", ["--diff", currentCheckpoint.commitHash], {
				cwd: workspacePath,
				detached: true,
				stdio: "ignore",
			})

			code.on("error", () => {
				const git = spawn("git", ["diff", currentCheckpoint?.commitHash], {
					cwd: workspacePath,
					stdio: "inherit",
				})
				git.on("error", () => undefined)
			})
		},
		[currentCheckpoint, sendToExtension, workspacePath],
	)

	const restore = useCallback(
		(mode: "preview" | "restore") => {
			if (!currentCheckpoint || !sendToExtension) {
				return
			}

			sendToExtension({
				type: "checkpointRestore",
				payload: {
					ts: currentCheckpoint.ts,
					commitHash: currentCheckpoint.commitHash,
					mode,
				},
			})
		},
		[currentCheckpoint, sendToExtension],
	)

	return { currentCheckpoint, showDiff, restore }
}
