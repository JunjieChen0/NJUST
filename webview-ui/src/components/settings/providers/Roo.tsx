import {
	type ProviderSettings,
	type OrganizationAllowList,
	type RouterModels,
	rooDefaultModelId,
} from "@roo-code/types"

import { ModelPicker } from "../ModelPicker"

type RooProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const Roo = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: RooProps) => {

	return (
		<>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={rooDefaultModelId}
				models={routerModels?.roo ?? {}}
				modelIdKey="apiModelId"
				serviceName="NJUST_AI_CJ Router"
				serviceUrl="https://github.com/RooCodeInc/Roo-Code"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
