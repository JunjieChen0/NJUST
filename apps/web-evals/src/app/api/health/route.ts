import { NextResponse } from "next/server"

import { FORBIDDEN_SECRETS, MIN_SECRET_LENGTH } from "@/lib/server/admin-auth"

export const dynamic = "force-dynamic"

/**
 * Health endpoint with separate liveness and readiness semantics.
 *
 * - **Liveness** (`alive`): process is running — always "ok".
 * - **Readiness** (`adminSecret`, `database`): security + data config present.
 *
 * Returns 503 only when readiness checks fail, so load balancers know the
 * process is alive but not yet ready to serve traffic.
 */
export async function GET() {
	const checks: Record<string, "ok" | "fail"> = {}

	// Liveness — process is alive
	checks.alive = "ok"

	// Readiness — security config
	const adminSecret = process.env.EVALS_ADMIN_SECRET
	if (!adminSecret || adminSecret.trim() === "") {
		checks.adminSecret = "fail"
	} else {
		const forbidden = FORBIDDEN_SECRETS
		if (forbidden.has(adminSecret.toLowerCase())) {
			checks.adminSecret = "fail"
		} else if (adminSecret.length < MIN_SECRET_LENGTH) {
			checks.adminSecret = "fail"
		} else {
			checks.adminSecret = "ok"
		}
	}

	// Readiness — database config
	const databaseUrl = process.env.DATABASE_URL
	checks.database = databaseUrl && databaseUrl.trim() !== "" ? "ok" : "fail"

	const hasReadinessFail = Object.entries(checks)
		.filter(([key]) => key !== "alive") // liveness doesn't affect readiness
		.some(([, v]) => v === "fail")
	const statusCode = hasReadinessFail ? 503 : 200

	return NextResponse.json(
		{
			status: hasReadinessFail ? "not_ready" : "healthy",
			checks,
		},
		{ status: statusCode },
	)
}
