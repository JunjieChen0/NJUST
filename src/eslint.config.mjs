import { config } from "@njust-ai/config-eslint/base-strict"
import vitest from "@vitest/eslint-plugin"
import catchRequiresLog from "./scripts/eslint-rules/catch-requires-log.mjs"

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
			"no-empty": ["error", { allowEmptyCatch: false }],
			"prefer-const": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: true }],
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/ban-ts-comment": [
				"warn",
				{ "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true },
			],
			"no-console": "error",
			// System A (shared/logger) is the default business logger. CompactLogger
			// is reserved for disk-compression diagnostics and must be imported by
			// its concrete path, never through the legacy utils/logging facade.
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/utils/logging", "**/utils/logging/index"],
							message:
								"Import business logging from shared/logger; use utils/logging/CompactLogger only for disk diagnostics.",
						},
					],
				},
			],
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/require-await": "warn",
			"@typescript-eslint/prefer-optional-chain": "warn",
		},
	},
	{
		files: ["core/task/CloudAgentOrchestrator.ts", "core/config/ContextProxy.ts"],
		plugins: {
			"njust-ai": { rules: { "catch-requires-log": catchRequiresLog } },
		},
		rules: {
			"njust-ai/catch-requires-log": "error",
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
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/prefer-optional-chain": "off",
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			parserOptions: {
				project: null, // 禁用 TS 项目检查，避免 .mjs 文件被当 TS 解析
			},
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
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/prefer-optional-chain": "off",
			"@typescript-eslint/require-await": "off",
			"no-console": "off",
		},
	},
	{
		files: ["shared/logger.ts"],
		rules: {
			"no-console": "off",
		},
	},
	{
		files: ["**/__tests__/**", "**/*.spec.ts", "**/*.test.ts", "**/__mocks__/**"],
		plugins: {
			vitest,
		},
		rules: {
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"no-console": "off",
			"vitest/no-focused-tests": "error",
			"vitest/no-identical-title": "error",
			"vitest/consistent-test-it": ["error", { fn: "it" }],
		},
	},
	{
		ignores: ["webview-ui", "out"],
	},
]
