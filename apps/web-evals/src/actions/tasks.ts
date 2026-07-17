"use server"

import { revalidatePath } from "next/cache"

import { getTasks as _getTasks } from "@njust-ai/evals"

import { requireAdminForAction } from "@/lib/server/admin-auth"
import { validateRunId } from "@/lib/server/validation"

export async function getTasks(runId: number) {
	await requireAdminForAction()
	const id = validateRunId(runId)
	const tasks = await _getTasks(id)
	revalidatePath(`/runs/${id}`)
	return tasks
}
