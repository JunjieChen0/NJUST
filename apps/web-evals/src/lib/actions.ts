"use server"

import { client, getProductionClient, copyRun } from "@njust-ai/evals"

import { requireAdminForAction } from "@/lib/server/admin-auth"
import { logAuditEvent } from "@/lib/server/audit"
import { validateRunId } from "@/lib/server/validation"

export async function copyRunToProduction(runId: number) {
	await requireAdminForAction()
	const id = validateRunId(runId)

	try {
		await copyRun({ sourceDb: client, targetDb: getProductionClient(), runId: id })

		logAuditEvent({ action: "run.copy_to_production", resource: String(id), result: "allowed" })

		return {
			success: true,
			message: `Run ${id} successfully copied to production.`,
		}
	} catch (error) {
		logAuditEvent({
			action: "run.copy_to_production",
			resource: String(id),
			result: "failed",
			reason: error instanceof Error ? error.message : "Unknown error",
		})

		return {
			success: false,
			error: `Failed to copy run ${id} to production.`,
		}
	}
}
