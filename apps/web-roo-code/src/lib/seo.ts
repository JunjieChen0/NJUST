const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://roocode.com"

export const SEO = {
	url: SITE_URL,
	name: "NJUST_AI_CJ",
	title: "NJUST_AI_CJ – The AI dev team that gets things done",
	description:
		"NJUST_AI_CJ puts an entire AI dev team right in your editor, outpacing closed tools with deep project-wide context, multi-step agentic coding, and unmatched developer-centric flexibility.",
	locale: "en_US",
	ogImage: {
		url: "/opengraph.png",
		width: 1200,
		height: 600,
		alt: "NJUST_AI_CJ",
	},
	keywords: [
		"NJUST_AI_CJ",
		"AI coding agent",
		"VS Code extension",
		"AI pair programmer",
		"software development",
		"agentic coding",
		"code refactoring",
		"debugging",
	],
	category: "technology",
	twitterCard: "summary_large_image" as const,
} as const

export type SeoConfig = typeof SEO
