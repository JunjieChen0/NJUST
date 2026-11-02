export const MAX_DESCRIPTION_LENGTH = 1000
export const MAX_BATCH_DELETE_COUNT = 1000
export const MAX_RUN_ID = 2147483647
export const MAX_TASKS_PER_RUN = 5000

const EXERCISE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Parses a `language/exercise` path, rejecting unknown languages and unsafe names. */
export function parseExercisePath<L extends string>(
	exercisePath: string,
	languages: readonly L[],
): { language: L; exercise: string } {
	const parts = exercisePath.split("/")
	const [language, exercise] = parts

	if (parts.length !== 2 || !language || !exercise) {
		throw new Error(`Invalid exercise path: ${exercisePath}`)
	}

	const knownLanguage = languages.find((l) => l === language)
	if (!knownLanguage) {
		throw new Error(`Unknown exercise language: ${language}`)
	}

	if (!EXERCISE_NAME_PATTERN.test(exercise)) {
		throw new Error(`Invalid exercise name: ${exercise}`)
	}

	return { language: knownLanguage, exercise }
}

export function validateTaskCount(taskCount: number): void {
	if (taskCount <= 0) {
		throw new Error("Run would create no tasks")
	}

	if (taskCount > MAX_TASKS_PER_RUN) {
		throw new Error(`Run would create ${taskCount} tasks (maximum ${MAX_TASKS_PER_RUN})`)
	}
}

export function validateRunId(runId: unknown): number {
	const num = Number(runId)

	if (!Number.isInteger(num) || num <= 0 || num > MAX_RUN_ID) {
		throw new Error("Invalid run ID: must be a positive integer")
	}

	return num
}

export function validateDescription(description: unknown): string | null {
	if (description === null || description === undefined) {
		return null
	}

	if (typeof description !== "string") {
		throw new Error("Invalid description: must be a string or null")
	}

	if (description.length > MAX_DESCRIPTION_LENGTH) {
		throw new Error(`Description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`)
	}

	return description
}
