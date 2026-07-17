import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/__tests__/**"],
			reporter: ["json", "text-summary"],
			reportsDirectory: "../../coverage/packages-telemetry",
			thresholds: {
				lines: 40,
				functions: 35,
				branches: 30,
				statements: 40,
			},
		},
	},
})
