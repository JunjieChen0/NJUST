import { findRun } from "@njust-ai/evals"

import { Run } from "./run"
import { requireAdminForPage } from "@/lib/server/admin-auth"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	await requireAdminForPage()
	const { id } = await params
	const run = await findRun(Number(id))

	return (
		<div className="w-full px-6 py-12">
			<Run run={run} />
		</div>
	)
}
