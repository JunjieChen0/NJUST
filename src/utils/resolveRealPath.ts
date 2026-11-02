import * as path from "path"
import * as fsSync from "fs"

/** Same limit as Linux (MAXSYMLINKS). */
const MAX_SYMLINK_HOPS = 40

/**
 * Resolves where a write to `absolutePath` would land, even if the path does not
 * exist yet. realpath fails with ENOENT both for a missing path and for a
 * dangling symlink; a dangling link is followed to its target (as a write
 * would), anything else falls back to the nearest existing parent.
 * Throws for errors other than ENOENT, and for link loops (ELOOP).
 */
export function resolveRealPathFollowingLinks(absolutePath: string): string {
	const missingSegments: string[] = []
	let current = absolutePath
	let hops = 0

	for (;;) {
		try {
			return path.join(fsSync.realpathSync(current), ...missingSegments)
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
		}

		let isLink = false
		try {
			isLink = fsSync.lstatSync(current)?.isSymbolicLink() ?? false
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
		}

		if (isLink) {
			hops++
			if (hops > MAX_SYMLINK_HOPS) {
				throw Object.assign(new Error(`Too many symbolic links: ${absolutePath}`), { code: "ELOOP" })
			}
			current = path.resolve(path.dirname(current), fsSync.readlinkSync(current))
			continue
		}

		const parent = path.dirname(current)
		if (parent === current) {
			throw Object.assign(new Error(`No existing ancestor: ${absolutePath}`), { code: "ENOENT" })
		}
		missingSegments.unshift(path.basename(current))
		current = parent
	}
}
