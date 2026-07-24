import { getRuns } from "@njust-ai/evals"

import { Runs } from "@/components/home/runs"
import { requireAdminForPage } from "@/lib/server/admin-auth"

export const dynamic = "force-dynamic"

export default async function Page() {
	await requireAdminForPage()
	const runs = await getRuns()
	return <Runs runs={runs} />
}
