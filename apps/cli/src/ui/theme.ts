/**
 * Theme configuration for NJUST_AI CLI TUI
 * Using opencode-style dynamic theme system
 */

import { loadTheme } from "./themes/index.ts"

// Initialize theme on module load
const theme = loadTheme("njust-ai", "dark")

export const titleColor = theme.primary
export const welcomeText = theme.text
export const asciiColor = theme.secondary
export const tipsHeader = theme.primary
export const tipsText = theme.textMuted
export const userHeader = theme.accent
export const rooHeader = theme.warning
export const toolHeader = theme.info
export const thinkingHeader = theme.textMuted
export const userText = theme.text
export const rooText = theme.text
export const toolText = theme.textMuted
export const thinkingText = theme.textMuted
export const borderColor = theme.border
export const borderColorActive = theme.borderActive
export const dimText = theme.textMuted
export const promptColor = theme.border
export const promptColorActive = theme.secondary
export const placeholderColor = theme.borderSubtle
export const successColor = theme.success
export const errorColor = theme.error
export const warningColor = theme.warning
export const focusColor = theme.secondary
export const scrollActiveColor = theme.accent
export const scrollTrackColor = theme.border
export const text = theme.text

// opencode-style keys
export const primary = theme.primary
export const secondary = theme.secondary
export const accent = theme.accent
export const error = theme.error
export const warning = theme.warning
export const success = theme.success
export const info = theme.info
export const textMuted = theme.textMuted
export const background = theme.background
export const backgroundPanel = theme.backgroundPanel
export const backgroundElement = theme.backgroundElement
export const border = theme.border
export const borderActive = theme.borderActive
export const borderSubtle = theme.borderSubtle
