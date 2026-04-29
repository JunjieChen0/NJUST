import { config } from "@njust-ai-cj/config-eslint/base"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		rules: {
			"no-regex-spaces": "warn",
			"no-useless-escape": "warn",
			"no-empty": "warn",
			"prefer-const": "warn",

			"@typescript-eslint/no-unused-vars": "warn",
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/ban-ts-comment": "off",
		},
	},
	{
		files: ["core/assistant-message/presentAssistantMessage.ts", "core/webview/webviewMessageHandler.ts"],
		rules: {
			"no-case-declarations": "off",
		},
	},
	{
		files: ["__mocks__/**/*.js"],
		rules: {
			"no-undef": "off",
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			globals: {
				process: "readonly",
				console: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				URL: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
			},
		},
	},
	{
		ignores: ["webview-ui", "out"],
	},
]
