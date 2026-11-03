import { defineConfig } from "vitest/config"

// Tests that need no database, so they can run in the regular CI test job.
// The full suite (vitest.config.ts) resets a Postgres test database first.
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/docker-policy-proxy/**/*.test.ts", "src/cangjie/**/*.test.ts"],
		watch: false,
	},
})
