import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings } from "@njust-ai/types"
import { doubaoCodingPlanBaseUrl, doubaoDefaultBaseUrl } from "@njust-ai/core/providers"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type DoubaoProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const Doubao = ({ apiConfiguration, setApiConfigurationField }: DoubaoProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<p className="text-sm text-vscode-descriptionForeground">{t("settings:providers.volcengineDescription")}</p>
			<VSCodeTextField
				value={apiConfiguration?.doubaoApiKey || ""}
				type="password"
				onInput={handleInputChange("doubaoApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.volcengineApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<VSCodeTextField
				value={apiConfiguration?.doubaoBaseUrl || doubaoDefaultBaseUrl}
				onInput={handleInputChange("doubaoBaseUrl")}
				placeholder={doubaoDefaultBaseUrl}
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2 space-y-1">
				<p>
					{t("settings:providers.volcengineBaseUrlDescription", {
						codingPlanBaseUrl: doubaoCodingPlanBaseUrl,
					})}
				</p>
				<p>{t("settings:providers.volcengineModelDescription")}</p>
			</div>
			{!apiConfiguration?.doubaoApiKey && (
				<VSCodeButtonLink href="https://docs.volcengine.com/docs/ark/api-key" appearance="secondary">
					{t("settings:providers.getVolcengineApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}
