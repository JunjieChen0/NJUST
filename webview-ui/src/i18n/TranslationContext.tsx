import React, { createContext, useContext, ReactNode, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import i18next, { loadTranslations } from "./setup"
import { useExtensionState } from "@/context/ExtensionStateContext"

const RICH_TEXT_TAG_PATTERN = /<\s*\/?\s*([A-Za-z][\w-]*|\d+)\s*>/
const warnedRichTextKeys = new Set<string>()

const warnOnRichTextTranslation = (key: string, value: unknown) => {
	if (process.env.NODE_ENV === "production" || typeof value !== "string") {
		return
	}

	if (!RICH_TEXT_TAG_PATTERN.test(value) || warnedRichTextKeys.has(key)) {
		return
	}

	warnedRichTextKeys.add(key)
	console.warn(
		`[i18n] Translation key "${key}" contains rich-text tags and was requested via t(). Use <Trans i18nKey="${key}" /> instead to avoid rendering raw tags.`,
	)
}

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Initialize with default configuration
	const { i18n } = useTranslation()
	// Get the extension state directly - it already contains all state properties
	const extensionState = useExtensionState()
	// Single source of truth for UI strings: extension host state (not i18n.language alone,
	// which can lag behind async changeLanguage and left stale memoized t()).
	const uiLanguage = extensionState.language ?? "en"

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	useEffect(() => {
		void i18n.changeLanguage(uiLanguage)
	}, [i18n, uiLanguage])

	const translate = useCallback(
		(key: string, options?: Record<string, any>) => {
			const { lng: _ignoredLng, ...rest } = options ?? {}
			const translatedValue = i18n.t(key, { ...rest, lng: uiLanguage })
			warnOnRichTextTranslation(key, translatedValue)
			return translatedValue
		},
		[i18n, uiLanguage],
	)

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
