import { Code2, Wrench, Sparkles, BookOpen } from "lucide-react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"

const tips = [
	{
		icon: <Code2 className="size-4 shrink-0 mt-0.5" />,
		titleKey: "chat:rooTips.cangjieToolchain.title",
		descriptionKey: "chat:rooTips.cangjieToolchain.description",
	},
	{
		icon: <Wrench className="size-4 shrink-0 mt-0.5" />,
		titleKey: "chat:rooTips.smartDiagnostics.title",
		descriptionKey: "chat:rooTips.smartDiagnostics.description",
	},
	{
		icon: <Sparkles className="size-4 shrink-0 mt-0.5" />,
		titleKey: "chat:rooTips.syntaxAndSnippets.title",
		descriptionKey: "chat:rooTips.syntaxAndSnippets.description",
	},
	{
		icon: <BookOpen className="size-4 shrink-0 mt-0.5" />,
		titleKey: "chat:rooTips.docsIntegration.title",
		descriptionKey: "chat:rooTips.docsIntegration.description",
	},
]

const RooTips = () => {
	const { t } = useAppTranslation()
	const { language } = useExtensionState()

	return (
		<div
			key={language ?? "en"}
			className="flex flex-col gap-2 mb-4 max-w-[500px] text-vscode-descriptionForeground">
			<p className="my-0 pr-2">{t("chat:about")}</p>
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
