import { config } from "@njust-ai/config-eslint/base-strict"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		files: ["**/*.ts"],
		rules: {
			"no-console": "error",
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["vscode", "vscode/*"],
							message:
								"packages/core must remain platform-agnostic. Do not import 'vscode'. Use interface injection instead.",
						},
					],
				},
			],
		},
	},
	{
		files: ["**/__tests__/**", "**/*.spec.ts", "**/*.test.ts", "**/__mocks__/**", "**/shared/logger.ts"],
		rules: {
			"no-console": "off",
		},
	},
]
