import { spawn } from "child_process"

import { createRun as dbCreateRun, createTask } from "@njust-ai/evals"

import type { CreateRun } from "@/lib/schemas"

vi.mock("child_process", () => ({
	execFileSync: vi.fn(),
	spawn: vi.fn(() => ({ stdout: null, stderr: null, on: vi.fn(), unref: vi.fn() })),
}))

vi.mock("fs", () => ({
	default: { existsSync: vi.fn().mockReturnValue(false), createWriteStream: vi.fn() },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/server/admin-auth", () => ({
	requireAdminForAction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/server/audit", () => ({ logAuditEvent: vi.fn() }))

vi.mock("@/lib/server/redis", () => ({ redisClient: vi.fn() }))

vi.mock("@njust-ai/evals", () => ({
	createRun: vi.fn().mockResolvedValue({ id: 42 }),
	deleteRun: vi.fn(),
	updateRun: vi.fn(),
	getIncompleteRuns: vi.fn(),
	deleteRunsByIds: vi.fn(),
	createTask: vi.fn().mockResolvedValue(undefined),
	exerciseLanguages: ["go", "python"],
	getExercisesForLanguage: vi.fn().mockResolvedValue([]),
}))

import { createRun } from "../runs"

const validPartial: CreateRun = {
	model: "test-model",
	suite: "partial",
	exercises: ["go/hello-world"],
	concurrency: 1,
	timeout: 5,
	iterations: 2,
	executionMethod: "vscode",
}

describe("createRun server-side validation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each([
		["iterations: 0", { ...validPartial, iterations: 0 }],
		["path traversal in exercise", { ...validPartial, exercises: ["go/../../etc"] }],
		["unknown language", { ...validPartial, exercises: ["cobol/hello-world"] }],
		["exercise without language", { ...validPartial, exercises: ["hello-world"] }],
	])("rejects %s before touching the database or spawning", async (_label, input) => {
		await expect(createRun(input as CreateRun)).rejects.toThrow()

		expect(dbCreateRun).not.toHaveBeenCalled()
		expect(createTask).not.toHaveBeenCalled()
		expect(spawn).not.toHaveBeenCalled()
	})

	it("rejects a full suite that would create no tasks", async () => {
		await expect(createRun({ ...validPartial, suite: "full", exercises: [] })).rejects.toThrow()

		expect(dbCreateRun).not.toHaveBeenCalled()
		expect(spawn).not.toHaveBeenCalled()
	})

	it("creates one task per exercise and iteration for valid input", async () => {
		await createRun(validPartial)

		expect(dbCreateRun).toHaveBeenCalledTimes(1)
		expect(createTask).toHaveBeenCalledTimes(2)
		expect(spawn).toHaveBeenCalledTimes(1)
	})
})
