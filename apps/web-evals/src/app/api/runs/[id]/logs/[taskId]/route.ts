import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import * as fs from "node:fs/promises"
import * as path from "node:path"

import { findTask, findRun } from "@njust-ai/evals"

import { requireAdminForRequest } from "@/lib/server/admin-auth"
import { validateOrigin } from "@/lib/server/origin-check"
import { validateRunId } from "@/lib/server/validation"

export const dynamic = "force-dynamic"

const LOG_BASE_PATH = "/tmp/evals/runs"

// Sanitize path components to prevent path traversal attacks
function sanitizePathComponent(component: string): string {
	// Remove any path separators, null bytes, and other dangerous characters
	return component.replace(/[/\\:\0*?"<>|]/g, "_")
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
	// Origin check — reject cross-origin requests
	if (!validateOrigin(request)) {
		return NextResponse.json({ error: "Forbidden: invalid origin" }, { status: 403 })
	}

	const authError = await requireAdminForRequest(request)
	if (authError) {
		return authError
	}

	const { id, taskId } = await params

	try {
		const runId = validateRunId(id)
		const taskIdNum = validateRunId(taskId)

		// Verify the run exists
		await findRun(runId)

		// Get the task to find its language and exercise
		const task = await findTask(taskIdNum)

		// Verify the task belongs to this run
		if (task.runId !== runId) {
			return NextResponse.json({ error: "Task does not belong to this run" }, { status: 404 })
		}

		// Sanitize language and exercise to prevent path traversal
		const safeLanguage = sanitizePathComponent(task.language)
		const safeExercise = sanitizePathComponent(task.exercise)

		// Construct the log file path
		const logFileName = `${safeLanguage}-${safeExercise}.log`
		const logFilePath = path.join(LOG_BASE_PATH, String(runId), logFileName)

		// Verify the resolved path is within the expected directory (defense in depth)
		const resolvedPath = path.resolve(logFilePath)
		const expectedBase = path.resolve(LOG_BASE_PATH)
		if (!resolvedPath.startsWith(expectedBase)) {
			return NextResponse.json({ error: "Invalid log path" }, { status: 400 })
		}

		// Check if the log file exists and read it (async)
		try {
			const logContent = await fs.readFile(logFilePath, "utf-8")
			return NextResponse.json({ logContent })
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				return NextResponse.json({ error: "Log file not found", logContent: null }, { status: 200 })
			}
			throw err
		}
	} catch (error) {
		console.error("Error reading task log:", error)

		if (error instanceof Error && error.message.startsWith("Invalid run ID")) {
			return NextResponse.json({ error: error.message }, { status: 400 })
		}

		if (error instanceof Error && error.name === "RecordNotFoundError") {
			return NextResponse.json({ error: "Task or run not found" }, { status: 404 })
		}

		return NextResponse.json({ error: "Failed to read log file" }, { status: 500 })
	}
}
