"use server"

import { redisClient } from "@/lib/server/redis"
import { requireAdminForAction } from "@/lib/server/admin-auth"
import { validateRunId } from "@/lib/server/validation"

export const getRunners = async (runId: number) => {
	await requireAdminForAction()
	const id = validateRunId(runId)
	const redis = await redisClient()
	return redis.sMembers(`runners:${id}`)
}
