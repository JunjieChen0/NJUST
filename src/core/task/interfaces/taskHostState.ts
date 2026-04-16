import type { ExtensionState } from "@njust-ai-cj/types"

/** Same shape as ClineProvider.getState() return type. */
export type TaskHostState = Omit<
	ExtensionState,
	"clineMessages" | "renderContext" | "hasOpenedModeSelector" | "version" | "shouldShowAnnouncement"
>
