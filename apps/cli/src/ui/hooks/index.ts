// Export existing hooks
export { TerminalSizeProvider, useTerminalSize } from "./TerminalSizeContext.tsx"
export { useToast, useToastStore } from "./useToast.ts"
export { useInputHistory } from "./useInputHistory.ts"

// Export new extracted hooks
export { useFollowupCountdown } from "./useFollowupCountdown.js"
export { useFocusManagement } from "./useFocusManagement.js"
export { useMessageHandlers } from "./useMessageHandlers.js"
export { useExtensionHost } from "./useExtensionHost.js"
export { useTaskSubmit } from "./useTaskSubmit.js"
export { useGlobalInput } from "./useGlobalInput.js"
export { usePickerHandlers } from "./usePickerHandlers.js"
export { useCondenseTask } from "./useCondenseTask.js"
export { useCheckpoints } from "./useCheckpoints.js"

// Export types
export type { UseFollowupCountdownOptions } from "./useFollowupCountdown.ts"
export type { UseFocusManagementOptions, UseFocusManagementReturn } from "./useFocusManagement.ts"
export type { UseMessageHandlersOptions, UseMessageHandlersReturn } from "./useMessageHandlers.ts"
export type { UseExtensionHostOptions, UseExtensionHostReturn } from "./useExtensionHost.ts"
export type { UseTaskSubmitOptions, UseTaskSubmitReturn } from "./useTaskSubmit.ts"
export type { UseGlobalInputOptions } from "./useGlobalInput.ts"
export type { UsePickerHandlersOptions, UsePickerHandlersReturn } from "./usePickerHandlers.ts"
