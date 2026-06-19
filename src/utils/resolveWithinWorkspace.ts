import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"

/**
 * Result of resolving a target path against a workspace base directory.
 *
 * - `ok: true`  → `resolved` is an absolute path guaranteed to be inside `base`
 *                 after symlink resolution.
 * - `ok: false` → `reason` describes why the target was rejected. Resolution
 *                 attempts that would escape the workspace, or that point at
 *                 absolute paths outside `base`, are reported here so callers
 *                 can refuse the operation with a user-readable message.
 */
export type ResolveWithinWorkspaceResult = { ok: true; resolved: string } | { ok: false; reason: string }

/**
 * Resolve a (possibly user-supplied) `target` path against `base` and verify
 * that the resulting absolute path stays inside `base`, even after symlinks
 * are followed. This is the canonical helper for cwd / file path inputs that
 * must not escape the workspace (CWE-22 path traversal).
 *
 * Behaviour:
 *  - If `target` is empty/undefined, returns `base` unchanged.
 *  - If `target` is relative, it is resolved against `base`.
 *  - If `target` is absolute, it is treated as-is and still must be within `base`.
 *  - `..` segments and symlinks are resolved before the boundary check.
 *  - For non-existent paths, the nearest existing parent is realpath'd, and
 *    the missing tail is appended back, mirroring `pathUtils.isPathOutsideWorkspace`.
 *
 * The function never throws on malformed input; it returns `ok: false` with a
 * reason instead. Callers should refuse the operation when `ok` is false.
 */
export function resolveWithinWorkspace(base: string, target: string | undefined | null): ResolveWithinWorkspaceResult {
	if (!base) {
		return { ok: false, reason: "Workspace base directory is not set" }
	}
	if (target === undefined || target === null || target === "") {
		const realBase = realpathBestEffort(path.resolve(base))
		return { ok: true, resolved: realBase }
	}
	if (typeof target !== "string") {
		return { ok: false, reason: "Target path must be a string" }
	}
	if (target.includes("\0")) {
		return { ok: false, reason: "Target path contains null byte" }
	}

	const absoluteBase = path.resolve(base)
	const absoluteTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(absoluteBase, target)

	const realBase = realpathBestEffort(absoluteBase)
	const realTarget = realpathBestEffort(absoluteTarget)

	if (!isInside(realBase, realTarget)) {
		return {
			ok: false,
			reason: `Target path '${target}' resolves outside workspace '${absoluteBase}'`,
		}
	}

	return { ok: true, resolved: realTarget }
}

/**
 * Same contract as {@link resolveWithinWorkspace} but uses async realpath where
 * possible. Falls back to sync resolution on errors so it is safe to call from
 * boundary code that already does async I/O nearby.
 */
export async function resolveWithinWorkspaceAsync(
	base: string,
	target: string | undefined | null,
): Promise<ResolveWithinWorkspaceResult> {
	if (!base) {
		return { ok: false, reason: "Workspace base directory is not set" }
	}
	if (target === undefined || target === null || target === "") {
		const realBase = await realpathBestEffortAsync(path.resolve(base))
		return { ok: true, resolved: realBase }
	}
	if (typeof target !== "string") {
		return { ok: false, reason: "Target path must be a string" }
	}
	if (target.includes("\0")) {
		return { ok: false, reason: "Target path contains null byte" }
	}

	const absoluteBase = path.resolve(base)
	const absoluteTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(absoluteBase, target)

	const realBase = await realpathBestEffortAsync(absoluteBase)
	const realTarget = await realpathBestEffortAsync(absoluteTarget)

	if (!isInside(realBase, realTarget)) {
		return {
			ok: false,
			reason: `Target path '${target}' resolves outside workspace '${absoluteBase}'`,
		}
	}

	return { ok: true, resolved: realTarget }
}

/**
 * Returns true when `child` is the same as `parent` or a path inside it,
 * after both have been resolved with `path.resolve`. Trailing separators are
 * normalised so `/foo/bar` is not treated as a child of `/foo/ba`.
 */
function isInside(parent: string, child: string): boolean {
	const normalisedParent = stripTrailingSep(parent)
	const normalisedChild = stripTrailingSep(child)
	if (normalisedChild === normalisedParent) return true
	const rel = path.relative(normalisedParent, normalisedChild)
	if (rel === "" || rel === ".") return true
	if (rel.startsWith("..")) return false
	if (path.isAbsolute(rel)) return false
	return true
}

function stripTrailingSep(p: string): string {
	// Windows drive root protection: `C:\` is the drive root, but `C:` (with
	// no trailing separator) means "the current working directory ON drive
	// C:" which is a different path. Stripping the slash off `C:\` would
	// silently change semantics. Same for forward-slash form `C:/`.
	if (/^[A-Za-z]:[\\/]$/.test(p)) {
		return p
	}
	if (p.length > 1 && p.endsWith(path.sep)) {
		return p.slice(0, -1)
	}
	return p
}

function realpathBestEffort(target: string): string {
	try {
		return fs.realpathSync(target)
	} catch {
		// Walk up to the nearest existing ancestor and reattach the missing tail.
		let current = target
		const missing: string[] = []
		while (true) {
			const parent = path.dirname(current)
			if (parent === current) {
				return target
			}
			try {
				const realParent = fs.realpathSync(parent)
				return path.join(realParent, path.basename(current), ...missing)
			} catch {
				missing.unshift(path.basename(current))
				current = parent
			}
		}
	}
}

async function realpathBestEffortAsync(target: string): Promise<string> {
	try {
		const r = await fsPromises.realpath(target)
		// Some test mocks return undefined for fsPromises.realpath; treat that
		// as if the path could not be resolved and fall through to the
		// walk-up behaviour. Production fs.realpath always returns a string.
		if (typeof r === "string") return r
	} catch {
		// fall through
	}

	let current = target
	const missing: string[] = []
	while (true) {
		const parent = path.dirname(current)
		if (parent === current) {
			return target
		}
		try {
			const realParent = await fsPromises.realpath(parent)
			if (typeof realParent === "string") {
				return path.join(realParent, path.basename(current), ...missing)
			}
			missing.unshift(path.basename(current))
			current = parent
		} catch {
			missing.unshift(path.basename(current))
			current = parent
		}
	}
}
