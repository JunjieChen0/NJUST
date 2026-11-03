import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { parse as parseToml } from "smol-toml"
import { logger } from "../../shared/logger"

const MANIFEST = "cjpm.toml"
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".njust_ai"])
const MAX_INPUT_FILES = 20_000
const MAX_CONTENT_BYTES = 5 * 1024 * 1024

export interface ProjectSnapshot {
	fingerprint: string
	files: Record<string, string>
	coverage: "complete" | "partial"
	gaps: string[]
}

/** Discover members and path dependencies before excluding each root's build output. */
async function projectRoots(root: string, gaps: string[]): Promise<Set<string>> {
	const roots = new Set<string>()
	const queue = [root]
	while (queue.length) {
		const requested = queue.shift()!
		let dir: string
		try {
			dir = await fs.realpath(requested)
		} catch (error) {
			logger.debug("projectFingerprint", "Project input directory unavailable", error)
			gaps.push(`Cannot read member/dependency: ${requested}`)
			continue
		}
		if (roots.has(dir)) continue
		roots.add(dir)
		try {
			const manifest = parseToml(await fs.readFile(path.join(dir, MANIFEST), "utf8"))
			const visit = (table: object): void => {
				for (const [key, value] of Object.entries(table)) {
					if (key === "path" && typeof value === "string") queue.push(path.resolve(dir, value))
					else if (value && typeof value === "object") visit(value)
				}
			}
			visit(manifest)
			const workspace = manifest.workspace
			if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
				const members = "members" in workspace ? workspace.members : undefined
				if (
					members !== undefined &&
					(!Array.isArray(members) || members.some((member) => typeof member !== "string"))
				) {
					gaps.push(`Invalid workspace members: ${dir}`)
				} else if (Array.isArray(members)) {
					for (const member of members) {
						if (typeof member !== "string") continue
						if (!member.includes("*")) {
							queue.push(path.resolve(dir, member))
							continue
						}
						if (!member.endsWith("/*") || member.slice(0, -2).includes("*")) {
							gaps.push(`Unsupported workspace pattern: ${dir}/${member}`)
							continue
						}
						const parent = path.resolve(dir, member.slice(0, -2))
						try {
							const children = (await fs.readdir(parent, { withFileTypes: true })).filter((entry) =>
								entry.isDirectory(),
							)
							if (!children.length) gaps.push(`Workspace pattern matched no members: ${parent}/*`)
							queue.push(...children.map((entry) => path.join(parent, entry.name)))
						} catch (error) {
							logger.debug("projectFingerprint", "Cannot expand workspace members", error)
							gaps.push(`Cannot read workspace members: ${parent}/*`)
						}
					}
				}
			}
		} catch (error) {
			logger.debug("projectFingerprint", "Cannot read project manifest", error)
			gaps.push(`Cannot read or parse manifest: ${path.join(dir, MANIFEST)}`)
		}
	}
	return roots
}

/** Hash all inputs, including test data and FFI; incomplete traversal never certifies success. */
export async function computeProjectSnapshot(projectRoot: string): Promise<ProjectSnapshot | undefined> {
	const root = path.resolve(projectRoot)
	try {
		await fs.access(path.join(root, MANIFEST))
	} catch (error) {
		logger.debug("projectFingerprint", "Project manifest unavailable", error)
		return undefined
	}
	const gaps: string[] = []
	const roots = await projectRoots(root, gaps)
	const visited = new Set<string>()
	const files = new Set<string>()
	const collect = async (dir: string): Promise<void> => {
		if (visited.has(dir)) return
		if (files.size >= MAX_INPUT_FILES) {
			gaps.push(`More than ${MAX_INPUT_FILES} input files`)
			return
		}
		visited.add(dir)
		try {
			for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
				const file = path.join(dir, entry.name)
				if (entry.name === "cangjie-eval-trace.jsonl" && path.basename(dir) === ".njust-ai") continue
				if (entry.isDirectory()) {
					if (!EXCLUDED_DIRS.has(entry.name) && !(roots.has(dir) && entry.name === "target"))
						await collect(file)
				} else if (entry.isFile() || entry.isSymbolicLink()) {
					if (files.size >= MAX_INPUT_FILES) {
						gaps.push(`More than ${MAX_INPUT_FILES} input files`)
						break
					}
					const stat = await fs.stat(file)
					if (stat.isFile()) files.add(file)
					else gaps.push(`Directory symlink or special input not followed: ${file}`)
				}
			}
		} catch (error) {
			logger.debug("projectFingerprint", "Cannot enumerate project inputs", error)
			gaps.push(`Cannot read input directory: ${dir}`)
		}
	}
	for (const dir of roots) await collect(dir)
	const inputs: Record<string, string> = {}
	const hash = crypto.createHash("sha256").update("cangjie-all-inputs-v2\0")
	for (const file of [...files].sort()) {
		try {
			const stat = await fs.stat(file)
			const content =
				stat.size > MAX_CONTENT_BYTES ? `metadata:${stat.size}:${stat.mtimeMs}` : await fs.readFile(file)
			const key = path.relative(root, file).split(path.sep).join("/")
			const digest = crypto.createHash("sha256").update(content).digest("hex")
			inputs[key] = digest
			hash.update(`${key}\0${digest}\n`)
		} catch (error) {
			logger.debug("projectFingerprint", "Cannot hash project input", error)
			gaps.push(`Cannot read input file: ${file}`)
		}
	}
	const uniqueGaps = [...new Set(gaps)].sort()
	hash.update(JSON.stringify(uniqueGaps))
	return {
		fingerprint: hash.digest("hex"),
		files: inputs,
		coverage: uniqueGaps.length ? "partial" : "complete",
		gaps: uniqueGaps,
	}
}

export async function computeProjectFingerprint(projectRoot: string): Promise<string | undefined> {
	return (await computeProjectSnapshot(projectRoot))?.fingerprint
}
