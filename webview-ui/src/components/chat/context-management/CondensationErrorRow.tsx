import { memo } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle } from "lucide-react"

interface CondensationErrorRowProps {
	errorText?: string
}

/**
 * Displays an error message when context condensation fails.
 * When the error indicates repeated failures (circuit breaker threshold nearing),
 * shows a more prominent warning with a suggestion to start a new conversation.
 */
export const CondensationErrorRow = memo(({ errorText }: CondensationErrorRowProps) => {
	const { t } = useTranslation()

	const isRepeatedFailure = errorText?.toLowerCase().includes("failed repeatedly") ||
		errorText?.toLowerCase().includes("repeated condensation failures") ||
		errorText?.toLowerCase().includes("degrading to truncation")

	const title = isRepeatedFailure
		? t("chat:contextManagement.circuitBreaker.title")
		: t("chat:contextManagement.condensation.errorHeader")

	const description = isRepeatedFailure
		? t("chat:contextManagement.circuitBreaker.description")
		: undefined

	return (
		<div className={`flex flex-col gap-1 ${isRepeatedFailure ? "p-3 bg-vscode-editor-background rounded border-l-2 border-vscode-editorWarning-foreground/60" : ""}`}>
			<div className="flex items-center gap-2">
				<AlertTriangle
					size={16}
					className={`shrink-0 ${
						isRepeatedFailure
							? "text-vscode-editorWarning-foreground"
							: "text-vscode-editorWarning-foreground opacity-80"
					}`}
				/>
				<span className={`font-bold ${isRepeatedFailure ? "text-vscode-editorWarning-foreground" : "text-vscode-foreground"}`}>
					{title}
				</span>
			</div>
			{errorText && !isRepeatedFailure && (
				<span className="text-vscode-descriptionForeground text-sm">{errorText}</span>
			)}
			{description && (
				<p className="text-vscode-descriptionForeground text-sm mt-1">{description}</p>
			)}
			{isRepeatedFailure && (
				<p className="text-vscode-descriptionForeground text-xs mt-1">
					{t("chat:contextManagement.circuitBreaker.suggestion")}
				</p>
			)}
		</div>
	)
})
