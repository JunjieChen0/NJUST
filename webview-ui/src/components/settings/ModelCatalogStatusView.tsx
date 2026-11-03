import type { ModelCatalogStatus } from "@njust-ai/types"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"

export function ModelCatalogStatusView({
	catalog,
	loading,
	failed,
	onRefresh,
}: {
	catalog?: ModelCatalogStatus
	loading: boolean
	failed: boolean
	onRefresh: () => void
}) {
	const { t } = useAppTranslation()
	const state = loading
		? "loading"
		: failed
			? "failed"
			: catalog?.refreshError === "unsupported"
				? "unsupported"
				: catalog?.refreshError
					? "failed"
					: catalog?.stale
						? "stale"
						: catalog?.source === "api"
							? "fresh"
							: catalog?.source === "hardcoded-fallback"
								? "builtin"
								: "cached"
	return (
		<div className="mb-2 text-sm" role="status">
			<div className="flex items-center justify-between gap-2">
				<span>{t(`settings:modelCatalog.${state}`)}</span>
				<Button variant="secondary" size="sm" disabled={loading} onClick={onRefresh}>
					{t("settings:modelCatalog.refresh")}
				</Button>
			</div>
			{catalog?.source === "hardcoded-fallback" && state !== "unsupported" && (
				<div>{t("settings:modelCatalog.builtin")}</div>
			)}
			{catalog?.fetchedAt && (
				<div className="text-vscode-descriptionForeground">
					{t("settings:modelCatalog.fetchedAt", { time: new Date(catalog.fetchedAt).toLocaleString() })}
				</div>
			)}
			{catalog?.refreshError && catalog.refreshError !== "unsupported" && (
				<div>{t(`settings:modelCatalog.errors.${catalog.refreshError}`)}</div>
			)}
		</div>
	)
}
