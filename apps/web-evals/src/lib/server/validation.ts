export const MAX_DESCRIPTION_LENGTH = 1000
export const MAX_BATCH_DELETE_COUNT = 1000
export const MAX_RUN_ID = 2147483647

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
