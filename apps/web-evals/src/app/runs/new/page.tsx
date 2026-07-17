import { NewRun } from "./new-run"
import { requireAdminForPage } from "@/lib/server/admin-auth"

export const dynamic = "force-dynamic"

export default async function Page() {
	await requireAdminForPage()
	return (
		<div className="max-w-3xl mx-auto px-12 p-12">
			<NewRun />
		</div>
	)
}
