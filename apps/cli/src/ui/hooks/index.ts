// Export existing hooks
export { TerminalSizeProvider, useTerminalSize } from "./TerminalSizeContext.tsx"
export { useToast, useToastStore } from "./useToast.ts"
export { useInputHistory } from "./useInputHistory.ts"

// Export new extracted hooks
export { useFollowupCountdown } from "./useFollowupCountdown.ts"
export { useFocusManagement } from "./useFocusManagement.ts"
export { useMessageHandlers } from "./useMessageHandlers.ts"
export { useExtensionHost } from "./useExtensionHost.ts"
export { useTaskSubmit } from "./useTaskSubmit.ts"
export { useGlobalInput } from "./useGlobalInput.ts"
export { usePickerHandlers } from "./usePickerHandlers.ts"

// Export types
export type { UseFollowupCountdownOptions } from "./useFollowupCountdown.ts"
export type { UseFocusManagementOptions, UseFocusManagementReturn } from "./useFocusManagement.ts"
export type { UseMessageHandlersOptions, UseMessageHandlersReturn } from "./useMessageHandlers.ts"
export type { UseExtensionHostOptions, UseExtensionHostReturn } from "./useExtensionHost.ts"
export type { UseTaskSubmitOptions, UseTaskSubmitReturn } from "./useTaskSubmit.ts"
export type { UseGlobalInputOptions } from "./useGlobalInput.ts"
export type { UsePickerHandlersOptions, UsePickerHandlersReturn } from "./usePickerHandlers.ts"
