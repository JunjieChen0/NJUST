import { randomBytes } from "node:crypto"

import { defineConfig } from "@playwright/test"

// Browser acceptance for the production build (run with `pnpm test:e2e`, which builds first).
// The admin secret is generated for this run only and shared with the server through the
// environment; it is never a real credential and never appears in a URL.
process.env.EVALS_ADMIN_SECRET ||= randomBytes(24).toString("hex")

const PORT = 3447
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
	testDir: "./e2e",
	testMatch: "*.test.ts",
	fullyParallel: false,
	retries: 0,
	use: {
		baseURL: BASE_URL,
		httpCredentials: { username: "admin", password: process.env.EVALS_ADMIN_SECRET },
	},
	webServer: {
		command: `next start -p ${PORT} -H 127.0.0.1`,
		// 401 counts as up; the tests authenticate through httpCredentials.
		url: `${BASE_URL}/runs/new`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
})
