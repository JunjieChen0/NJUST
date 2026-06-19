import * as path from "path"
import { z } from "zod"

import type { WorkspaceOp } from "./types"

/** Max number of operations per /v1/run response. */
export const WORKSPACE_OPS_MAX_COUNT = 50

/** Max length for path, and for content/diff body fields (chars). */
export const WORKSPACE_OPS_MAX_PATH_LEN = 4096
export const WORKSPACE_OPS_MAX_BODY_CHARS = 1_000_000

/**
 * Validate that a workspace op path is safe.
 *
 * Hardened against:
 *  - null byte injection (`\0`)
 *  - literal `..` traversal
 *  - absolute paths (Unix or Windows)
 *  - URL-encoded traversal segments at any case (`%2e%2e`, `%2E%2e`, …)
 *  - **DOUBLE-ENCODED** traversal (`%252e%252e`) and deeper, by repeatedly
 *    decoding the path up to {@link MAX_DECODE_PASSES} times until it stops
 *    changing, and inspecting every intermediate form.
 *
 * Termination contract:
 *  - The loop checks the path at every depth (input → 1× decode → … → Nth).
 *  - If decoding still changes the string after `MAX_DECODE_PASSES`, we
 *    REJECT because we cannot prove the string is benign without unbounded
 *    work. Earlier versions returned `true` here, which let attackers wrap
 *    `..` in 7+ layers of `%`-encoding to bypass the check.
 *  - Decode failures (malformed `%XX`) abort the loop. The current form has
 *    already been checked, so we conclude `true` if no traversal was seen.
 */
const MAX_DECODE_PASSES = 5

function isPathSafe(p: string): boolean {
	if (typeof p !== "string" || p.length === 0) return false
	if (p.includes("\0")) return false // null byte injection

	// Run all checks against the original AND every decoded form. A malicious
	// path only needs to fail one form to be rejected; a benign path with `%20`
	// in the filename will decode to a space and still pass.
	let current = p
	for (let i = 0; i <= MAX_DECODE_PASSES; i++) {
		if (containsTraversalOrAbsolute(current)) return false

		let decoded: string
		try {
			decoded = decodeURIComponent(current)
		} catch {
			// Malformed percent-encoding — the current form was just checked
			// above, so we can stop here.
			return true
		}
		if (decoded === current) {
			return true // stable; nothing more to inspect
		}
		// Check the decoded form BEFORE advancing so a final pass that
		// surfaces `..` is caught. This closes the gap where the previous
		// version exited the loop without checking the last `current`.
		if (containsTraversalOrAbsolute(decoded)) return false
		current = decoded
	}

	// Budget exhausted while the string is STILL changing under decode. Any
	// remaining encoded structure is suspicious — refuse rather than admit a
	// path we couldn't fully normalise. Defends against attackers stacking
	// 7+ layers of `%`-encoding.
	return false
}

function containsTraversalOrAbsolute(p: string): boolean {
	if (p.includes("..")) return true // literal traversal
	if (p.includes("\0")) return true // null byte after a decode pass
	if (path.isAbsolute(p)) return true // posix or windows absolute
	if (/^[A-Za-z]:[\\/]/.test(p)) return true // explicit Windows drive even on posix
	if (/%2e%2e/i.test(p)) return true // single-encoded traversal that survived this pass
	return false
}

const safePathMessage =
	"Invalid path: absolute paths, '..' traversal, null bytes, and (multiply) URL-encoded traversal are blocked"

const writeFileOpSchema = z.object({
	op: z.literal("write_file"),
	path: z.string().max(WORKSPACE_OPS_MAX_PATH_LEN).refine(isPathSafe, safePathMessage),
	content: z.string().max(WORKSPACE_OPS_MAX_BODY_CHARS),
})

const applyDiffOpSchema = z.object({
	op: z.literal("apply_diff"),
	path: z.string().max(WORKSPACE_OPS_MAX_PATH_LEN).refine(isPathSafe, safePathMessage),
	diff: z.string().max(WORKSPACE_OPS_MAX_BODY_CHARS),
})

const workspaceOpSchema = z.discriminatedUnion("op", [writeFileOpSchema, applyDiffOpSchema])

const workspaceOpsEnvelopeSchema = z.object({
	version: z.literal(1).optional(),
	operations: z.array(workspaceOpSchema).max(WORKSPACE_OPS_MAX_COUNT),
})

export interface ParseWorkspaceOpsResult {
	operations: WorkspaceOp[]
	/** Set when workspace_ops was present but invalid. */
	error?: string
}

/**
 * Extract and validate workspace_ops from a parsed /v1/run JSON object.
 * Never throws; invalid payloads yield empty operations and an error message for logging.
 */
export function parseWorkspaceOps(data: unknown): ParseWorkspaceOpsResult {
	if (data === null || typeof data !== "object") {
		return { operations: [] }
	}

	const record = data as Record<string, unknown>
	const raw = record.workspace_ops
	if (raw === undefined || raw === null) {
		return { operations: [] }
	}

	const parsed = workspaceOpsEnvelopeSchema.safeParse(raw)
	if (!parsed.success) {
		return {
			operations: [],
			error:
				parsed.error.flatten().formErrors.join("; ") ||
				parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
				parsed.error.message,
		}
	}

	return { operations: parsed.data.operations as WorkspaceOp[] }
}
