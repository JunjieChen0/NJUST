import { defineConfig, defaultExclude } from "vitest/config"
import path from "path"
import { resolveVerbosity } from "./utils/vitest-verbosity"

const { silent, reporters } = resolveVerbosity()

export default defineConfig({
	test: {
		globals: true,
		setupFiles: [path.resolve(__dirname, "./vitest.setup.ts")],
		exclude: [
			...defaultExclude,
			".claude/**",
			"**/.claude/**",
			"webview-ui/**",
			"apps/**",
			"packages/**",
			"**/out/**",
		],
		watch: false,
		reporters,
		silent,
		// Vitest intercepts worker console calls and reports them over an RPC that can
		// still be pending when a worker tears down, failing the run with
		// EnvironmentTeardownError ("onUserConsoleLog" was pending). Letting console
		// write straight to stdout removes that RPC entirely.
		disableConsoleIntercept: true,
		pool: "forks",
		maxWorkers: process.env.CI ? 4 : undefined,
		testTimeout: 30_000,
		hookTimeout: 30_000,
		retry: 0,
		coverage: {
			provider: "v8",
			reporter: ["json", "html", "text-summary"],
			reportsDirectory: "../coverage/src",
			include: [
				"src/core/**",
				"src/api/**",
				"src/services/**",
				"src/chat/**",
				"src/utils/**",
				"src/integrations/**",
				"src/activate/**",
				"src/shared/**",
				"src/i18n/**",
			],
			exclude: [
				"**/__tests__/**",
				"**/__mocks__/**",
				"src/services/cangjie-corpus/**",
				"src/core/task/interfaces/**",
				"**/ClassifierStrategy.ts",
			],
			thresholds: {
				lines: 68.9,
				functions: 69,
				branches: 60,
				statements: 68,
				// Security-sensitive paths get their own floor so regressions here fail
				// even while the repo-wide totals still pass. Floors sit ~2 points below the
				// CI (Linux) baseline; platform-specific branches make Windows/Linux differ.
				"src/services/sandbox/**": {
					lines: 82,
					functions: 85,
					branches: 68,
					statements: 80,
				},
				"src/services/cloud-agent/**": {
					functions: 85,
					branches: 74,
					statements: 82,
				},
				"src/core/task/**": {
					functions: 70,
					branches: 63,
					statements: 73,
				},
			},
		},
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "./__mocks__/vscode.js"),
		},
	},
})
