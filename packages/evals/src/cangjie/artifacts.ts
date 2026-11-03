import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const ignored = new Set(["target", ".git", ".njust_ai", ".njust-ai", ".cangjie-index"])

export async function inputFiles(root: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {}
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const absolute = path.join(dir, entry.name)
			if (entry.isDirectory() && !ignored.has(entry.name)) await walk(absolute)
			else if (entry.isFile())
				result[path.relative(root, absolute).split(path.sep).join("/")] = await fs.readFile(absolute, "utf8")
		}
	}
	await walk(root)
	return result
}

export function contentFingerprint(files: Record<string, string>): string {
	return createHash("sha256")
		.update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))))
		.digest("hex")
}

export async function writeFinalDiff(
	before: Record<string, string>,
	after: Record<string, string>,
	dir: string,
): Promise<string[]> {
	const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.filter((file) => before[file] !== after[file])
		.sort()
	const patches: string[] = []
	for (const [index, file] of changed.entries()) {
		const oldFile = path.join(dir, `before-${index}.txt`)
		const newFile = path.join(dir, `after-${index}.txt`)
		await fs.writeFile(oldFile, before[file] ?? "")
		await fs.writeFile(newFile, after[file] ?? "")
		try {
			const output = await execFileAsync("git", ["diff", "--no-index", "--no-ext-diff", "--", oldFile, newFile], {
				maxBuffer: 4 * 1024 * 1024,
			})
			patches.push(output.stdout)
		} catch (error) {
			const failed = error as Error & { code?: number; stdout?: string }
			if (failed.code !== 1 || !failed.stdout) throw error
			patches.push(`# ${file}\n${failed.stdout}`)
		}
	}
	await fs.writeFile(path.join(dir, "final.diff"), patches.join("\n"))
	return changed
}
