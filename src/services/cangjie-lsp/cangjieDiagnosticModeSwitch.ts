/**
 * Clears extension-owned Cangjie diagnostics (cjlint, cjpm compile) when leaving cangjie mode.
 * Does not touch the language server diagnostic collection.
 */
export const cangjieDiagnosticModeSwitch = {
	clearCjlint: undefined as (() => void) | undefined,
	clearCjpm: undefined as (() => void) | undefined,

	clearExtensionCangjieDiagnostics(): void {
		try {
			this.clearCjlint?.()
		} catch {
			/* ignore */
		}
		try {
			this.clearCjpm?.()
		} catch {
			/* ignore */
		}
	},
}
