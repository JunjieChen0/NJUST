import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { Trans } from "react-i18next"

import { ReplaceAll, Users } from "lucide-react"

const tips = [
	{
		icon: <Users className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.customizableModes.title",
		descriptionKey: "rooTips.customizableModes.description",
	},
	{
		icon: <ReplaceAll className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.modelAgnostic.title",
		descriptionKey: "rooTips.modelAgnostic.description",
	},
]

const RooTips = () => {
	const { t } = useTranslation("chat")

	return (
		<div className="flex flex-col gap-2 mb-4 max-w-[500px] text-vscode-descriptionForeground">
			<p className="my-0 pr-2">
				<Trans i18nKey="chat:about" />
			</p>
			<div className="gap-4">
				{tips.map((tip) => (
					<div key={tip.titleKey} className="flex items-start gap-2 mt-2 mr-6 leading-relaxed">
						{tip.icon}
						<span>
							{t(tip.titleKey)}: {t(tip.descriptionKey)}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

export default RooTips
