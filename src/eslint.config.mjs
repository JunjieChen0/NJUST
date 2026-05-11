import { config } from "@njust-ai-cj/config-eslint/base-strict"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		languageOptions: {
			parserOptions: {
				project: "./.eslint-tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"no-regex-spaces": "warn",
			"no-useless-escape": "warn",
			"no-empty": ["error", { allowEmptyCatch: true }],
			"prefer-const": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/no-explicit-any": ["warn", { ignoreRestArgs: true }],
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/ban-ts-comment": ["warn", { "ts-expect-error": false, "ts-ignore": true, "ts-nocheck": true }],
			"no-console": ["error", { allow: ["error"] }],
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/require-await": "warn",
			"@typescript-eslint/prefer-optional-chain": "warn",
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
		languageOptions: {
			parserOptions: {
				project: null, // 禁用 TS 项目检查，避免 JS 文件被当 TS 解析
			},
		},
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
		files: ["shared/logger.ts"],
		rules: {
			"no-console": "off",
		},
	},
	{
		ignores: ["webview-ui", "out"],
	},
]
