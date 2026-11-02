import { configDefaults, defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		watch: false,
		// e2e/ holds Playwright browser tests (pnpm test:e2e), not Vitest tests.
		exclude: [...configDefaults.exclude, "e2e/**"],
	},
})
