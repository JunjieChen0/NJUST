import * as crypto from "crypto"
import type { Dirent } from "fs"
import * as fs from "fs/promises"
import * as path from "path"

import { logger } from "../../shared/logger"

const MANIFEST = "cjpm.toml"
const INPUT_FILE_NAMES = new Set([MANIFEST, "cjpm.lock"])
const EXCLUDED_DIRS = new Set([".git", "node_modules"])
/** cjpm build output; only excluded at a project root so a source package named "target" still counts. */
const ROOT_BUILD_OUTPUT_DIR = "target"
/** Guard against accidentally hashing a huge tree (e.g. a path dependency pointing at a home dir). */
const MAX_INPUT_FILES = 20_000
const PATH_DEPENDENCY_RE = /\bpath\s*=\s*"([^"]+)"/g

function isInputFile(name: string): boolean {
	return INPUT_FILE_NAMES.has(name) || name.toLowerCase().endsWith(".cj")
}

function isExcludedDir(name: string, isProjectRoot: boolean): boolean {
	return EXCLUDED_DIRS.has(name) || (isProjectRoot && name === ROOT_BUILD_OUTPUT_DIR)
}

/** Symlinked files count as inputs; symlinked directories are not followed (avoids cycles). */
async function isInputFileEntry(dir: string, entry: Dirent): Promise<boolean> {
	if (!isInputFile(entry.name)) return false
	if (entry.isFile()) return true
	if (!entry.isSymbolicLink()) return false
	const stat = await fs.stat(path.join(dir, entry.name)).catch(() => undefined)
	return stat?.isFile() === true
}

async function collectInputFiles(dir: string, out: string[], isProjectRoot = true): Promise<void> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (!isExcludedDir(entry.name, isProjectRoot))
				await collectInputFiles(path.join(dir, entry.name), out, false)
		} else if (await isInputFileEntry(dir, entry)) {
			out.push(path.join(dir, entry.name))
			if (out.length > MAX_INPUT_FILES) throw new Error(`more than ${MAX_INPUT_FILES} input files`)
		}
	}
}

async function readPathDependencies(projectRoot: string): Promise<string[]> {
	const manifest = await fs.readFile(path.join(projectRoot, MANIFEST), "utf8")
	return [...manifest.matchAll(PATH_DEPENDENCY_RE)].flatMap((m) => (m[1] ? [path.resolve(projectRoot, m[1])] : []))
}

/** Project roots whose inputs affect the build: the project plus its local path dependencies (transitively). */
async function collectProjectRoots(projectRoot: string): Promise<string[]> {
	const seen = new Set<string>()
	const queue = [path.resolve(projectRoot)]
	while (queue.length > 0) {
		const root = queue.shift()!
		if (seen.has(root)) continue
		seen.add(root)
		try {
			queue.push(...(await readPathDependencies(root)))
		} catch (error) {
			// A dependency without its own manifest still contributes its files; it just declares no deps.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	}
	return [...seen]
}

/**
 * Content fingerprint of everything that determines a cjpm build/test result: `.cj` sources
 * (tracked or not), `cjpm.toml`, `cjpm.lock`, and local path dependencies. Build output and
 * VCS metadata are excluded. Returns undefined when the project cannot be fingerprinted.
 */
export async function computeProjectFingerprint(projectRoot: string): Promise<string | undefined> {
	const root = path.resolve(projectRoot)
	try {
		await fs.access(path.join(root, MANIFEST))
		const files: string[] = []
		for (const inputRoot of await collectProjectRoots(root)) {
			await collectInputFiles(inputRoot, files)
		}

		const hash = crypto.createHash("sha256")
		for (const file of [...new Set(files)].sort()) {
			const content = await fs.readFile(file)
			const rel = path.relative(root, file).split(path.sep).join("/")
			hash.update(`${rel}\0${crypto.createHash("sha256").update(content).digest("hex")}\n`)
		}
		return hash.digest("hex")
	} catch (error) {
		logger.warn("projectFingerprint", `Cannot fingerprint ${root}`, error)
		return undefined
	}
}
