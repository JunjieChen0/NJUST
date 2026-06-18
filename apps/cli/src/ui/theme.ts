/**
 * Theme module shim — re-exports from `./theme/index.tsx`.
 *
 * The old palette implementation (flat `darkTheme`/`lightTheme` constants) has
 * been replaced by an OpenCode-compatible JSON-driven theme system. To avoid
 * touching the 28 existing call sites that import from `"./theme.js"`, this
 * file simply forwards to the new module. New code should import directly
 * from `"./theme/index.js"` (or just rely on this shim).
 */

export { useTheme, getTheme, useResolvedTheme, useThemeStore, useThemeHydration } from "./theme/index.js"
export { setActiveTheme, setThemeMode, pinThemeMode, unpinThemeMode } from "./theme/index.js"
export { listAllThemeNames } from "./theme/index.js"
export { tint } from "./theme/index.js"
export type { ThemePalette, ResolvedTheme, ThemeMode } from "./theme/index.js"
