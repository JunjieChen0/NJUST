import * as fs from "fs/promises"
import * as path from "path"
import { discoverProjectRoots } from "./projectFingerprint"
import { logger } from "../../shared/logger"

const MANIFEST = "cjpm.toml"

/** Native realpath also expands Windows short names; retain missing/deleted path segments. */
export async function canonicalVerificationPath(file: string): Promise<string> {
	let current = path.resolve(file)
	const missing: string[] = []
	while (true) {
		try {
			return path.join(await fs.realpath(current), ...missing)
		} catch (error) {
			logger.debug("projectRoot", "Resolving input path through an existing ancestor", error)
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			const parent = path.dirname(current)
			if (parent === current) throw error
			missing.unshift(path.basename(current))
			current = parent
		}
	}
}

export type ProjectRootResolution =
	| { kind: "resolved"; root: string }
	| { kind: "blocked"; reason: string; candidates: string[] }

async function hasManifest(dir: string): Promise<boolean> {
	try {
		await fs.access(path.join(dir, MANIFEST))
		return true
	} catch {
		return false
	}
}

/** Walk up from `startDir` to the nearest directory containing cjpm.toml. */
export async function findNearestCjpmRoot(startDir: string): Promise<string | undefined> {
	let current = path.resolve(startDir)
	while (true) {
		if (await hasManifest(current)) return current
		const parent = path.dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

async function uniqueRoots(dirs: readonly string[]): Promise<string[]> {
	const roots = await Promise.all(dirs.map(findNearestCjpmRoot))
	return [...new Set(roots.filter((root): root is string => root !== undefined))]
}

function decide(roots: string[], source: string): ProjectRootResolution | undefined {
	const [only] = roots
	if (roots.length === 1 && only !== undefined) return { kind: "resolved", root: only }
	if (roots.length > 1) {
		return {
			kind: "blocked",
			reason: `${source} belong to ${roots.length} different cjpm projects; cannot pick one to verify`,
			candidates: roots,
		}
	}
	return undefined
}

/**
 * Pick the cjpm project to verify. Priority: the project(s) containing files this task wrote,
 * then the project containing the task cwd, then the only workspace folder with a cjpm.toml.
 * Ambiguity is reported as blocked rather than guessed.
 */
export async function resolveVerificationProjectRoot(input: {
	writtenPaths: readonly string[]
	cwd: string
	workspaceFolders: readonly string[]
}): Promise<ProjectRootResolution> {
	const writtenRoots = await uniqueRoots(input.writtenPaths.map((p) => path.dirname(p)))
	const fromCwd = await findNearestCjpmRoot(input.cwd)
	if (fromCwd) {
		const ownedRoots = await discoverProjectRoots(fromCwd)
		const canonicalWrites = await Promise.all(writtenRoots.map((root) => fs.realpath(root)))
		if (canonicalWrites.every((root) => ownedRoots.has(root))) return { kind: "resolved", root: fromCwd }
	}
	const fromWrites = decide(writtenRoots, "Files written by this task")
	if (fromWrites) return fromWrites

	if (fromCwd) return { kind: "resolved", root: fromCwd }

	const workspaceRoots: string[] = []
	for (const folder of input.workspaceFolders) {
		if (await hasManifest(folder)) workspaceRoots.push(path.resolve(folder))
	}
	return (
		decide([...new Set(workspaceRoots)], "Workspace folders") ?? {
			kind: "blocked",
			reason: "No cjpm.toml found for the task's files, working directory, or workspace folders",
			candidates: [],
		}
	)
}
