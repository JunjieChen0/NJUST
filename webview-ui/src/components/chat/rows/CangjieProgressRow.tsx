import { useTranslation } from "react-i18next"
import type { CangjieTaskProgress } from "@njust-ai/types"

export function CangjieProgressRow({ progress }: { progress: CangjieTaskProgress }) {
	const { t } = useTranslation()
	return (
		<section
			role="status"
			aria-live="polite"
			className="my-2 rounded border border-vscode-panel-border p-2 text-sm">
			<strong>{t(`delivery:stages.${progress.stage}`)}</strong>: {t(`delivery:progressStates.${progress.status}`)}
			{progress.projectRoot && (
				<div className="break-all">
					{t("delivery:projectRoot")}: {progress.projectRoot}
				</div>
			)}
			{progress.sdkVersion && <div>{progress.sdkVersion}</div>}
			{progress.detail && <div className="break-all">{progress.detail}</div>}
		</section>
	)
}
