import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Copy, Check, Microscope, Info, Terminal } from "lucide-react"

import { useCopyToClipboard } from "@/utils/clipboard"
import { vscode } from "@/utils/vscode"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { PROVIDERS } from "@/components/settings/constants"

type CloudAgentTechnicalDetailDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Raw technical text (metadata is prepended like ErrorRow) */
	plainText: string
}

/**
 * Matches `ErrorRow` error-details dialog: centered title, bordered mono body, copy + diagnostics pills.
 */
export function CloudAgentTechnicalDetailDialog({
	open,
	onOpenChange,
	plainText,
}: CloudAgentTechnicalDetailDialogProps) {
	const { t } = useTranslation()
	const { version, apiConfiguration } = useExtensionState()
	const { provider, id: modelId } = useSelectedModel(apiConfiguration)
	const usesProxy = PROVIDERS.find((p) => p.value === provider)?.proxy ?? false
	const { copyWithFeedback } = useCopyToClipboard()
	const [showCopySuccess, setShowCopySuccess] = useState(false)

	const formattedDetails = useMemo(() => {
		const metadata = [
			`Date/time: ${new Date().toISOString()}`,
			`Extension version: ${version}`,
			`Provider: ${provider}${usesProxy ? " (proxy)" : ""}`,
			`Model: ${modelId}`,
			"",
			"",
		].join("\n")
		return metadata + plainText
	}, [plainText, version, provider, modelId, usesProxy])

	const handleCopyDetails = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			const ok = await copyWithFeedback(formattedDetails)
			if (ok) {
				setShowCopySuccess(true)
				window.setTimeout(() => setShowCopySuccess(false), 1000)
			}
		},
		[formattedDetails, copyWithFeedback],
	)

	const handleDownloadDiagnostics = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			vscode.postMessage({
				type: "downloadErrorDiagnostics",
				values: {
					timestamp: new Date().toISOString(),
					version,
					provider,
					model: modelId,
					details: plainText,
				},
			})
		},
		[version, provider, modelId, plainText],
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="ca-tech-detail-dialog-v2 max-w-2xl flex min-h-0 w-full max-h-[min(88vh,760px)] flex-col gap-4 overflow-hidden p-6">
				<div className="ca-tech-detail-dialog__header shrink-0">
					<div className="ca-tech-detail-dialog__icon-wrap" aria-hidden>
						<Terminal className="ca-tech-detail-dialog__icon" strokeWidth={2.25} />
					</div>
					<div className="ca-tech-detail-dialog__title-group">
						<DialogTitle className="ca-tech-detail-dialog__title">
							{t("chat:cloudAgent.technicalDetailTitle")}
						</DialogTitle>
					</div>
				</div>
				<div className="ca-tech-detail-dialog__scroll w-full min-h-0 min-w-0 flex-1 self-stretch overflow-y-auto rounded-xl border border-vscode-editorGroup-border bg-vscode-editor-background">
					<pre className="m-0 whitespace-pre-wrap break-words bg-transparent px-3 py-2 font-mono text-sm text-vscode-editor-foreground">
						{plainText}
					</pre>
					{usesProxy && (
						<div className="cursor-default flex gap-2 border-t border-vscode-editorGroup-border bg-foreground/5 px-3 py-2 text-vscode-button-secondaryForeground">
							<Info className="mt-1 size-3 shrink-0 text-vscode-descriptionForeground" />
							<span className="text-sm text-vscode-descriptionForeground">
								{t("chat:errorDetails.proxyProvider")}
							</span>
						</div>
					)}
				</div>
				<DialogFooter className="ca-tech-detail-dialog__actions mt-0 w-full shrink-0 flex-col sm:flex-col">
					<button
						type="button"
						className="ca-tech-btn ca-tech-btn--copy"
						onClick={handleCopyDetails}>
						{showCopySuccess ? (
							<Check className="ca-tech-btn__icon" strokeWidth={2.5} />
						) : (
							<Copy className="ca-tech-btn__icon" strokeWidth={2.5} />
						)}
						{showCopySuccess ? t("chat:errorDetails.copied") : t("chat:errorDetails.copyToClipboard")}
					</button>
					<button
						type="button"
						className="ca-tech-btn ca-tech-btn--diagnose"
						onClick={handleDownloadDiagnostics}>
						<Microscope className="ca-tech-btn__icon" strokeWidth={2.5} />
						{t("chat:errorDetails.diagnostics")}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
