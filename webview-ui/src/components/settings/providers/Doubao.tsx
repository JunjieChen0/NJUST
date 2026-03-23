import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@njust-ai-cj/types"

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
			<VSCodeTextField
				value={apiConfiguration?.doubaoApiKey || ""}
				type="password"
				onInput={handleInputChange("doubaoApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">Doubao API Key</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<VSCodeTextField
				value={apiConfiguration?.doubaoBaseUrl || "https://ark.cn-beijing.volces.com/api/v3"}
				onInput={handleInputChange("doubaoBaseUrl")}
				placeholder="https://ark.cn-beijing.volces.com/api/v3"
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				如使用自定义接入点 (Endpoint)，可将模型名替换为接入点 ID
			</div>
			{!apiConfiguration?.doubaoApiKey && (
				<VSCodeButtonLink href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" appearance="secondary">
					Get Doubao API Key
				</VSCodeButtonLink>
			)}
		</>
	)
}
