import * as fs from "fs/promises"
import * as path from "path"
import { z } from "zod"

import { logger } from "../../shared/logger"
import type { ProjectSnapshot } from "./projectFingerprint"

const SNAPSHOT_DIR = "verification-snapshots"
const MAX_SNAPSHOTS = 30
const fingerprintSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/)
const snapshotSchema = z.object({ fingerprint: fingerprintSchema, files: z.record(z.string(), z.string()) })
const writes = new Map<string, Promise<void>>()

/** Serialize saves and retention per task. Only extension-owned snapshot JSON files are pruned. */
export function saveSnapshot(taskDir: string, snapshot: ProjectSnapshot, keep: readonly string[] = []): Promise<void> {
	const dir = path.resolve(taskDir, SNAPSHOT_DIR)
	const next = (writes.get(dir) ?? Promise.resolve())
		.catch((error) => logger.debug("SnapshotStore", "Previous snapshot save failed", error))
		.then(async () => {
			const data = snapshotSchema.parse(snapshot)
			await fs.mkdir(dir, { recursive: true })
			const file = path.join(dir, `${data.fingerprint}.json`)
			try {
				await fs.writeFile(file, JSON.stringify(data), {
					encoding: "utf8",
					flag: "wx",
				})
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
				logger.debug("SnapshotStore", `Refreshing existing snapshot ${data.fingerprint}`)
				const now = new Date()
				await fs.utimes(file, now, now)
			}
			const entries = await fs.readdir(dir, { withFileTypes: true })
			const snapshots = await Promise.all(
				entries
					.filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]+\.json$/.test(entry.name))
					.map(async (entry) => ({
						name: entry.name,
						time: (await fs.stat(path.join(dir, entry.name))).mtimeMs,
					})),
			)
			snapshots.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))
			const protectedNames = new Set(keep.map((fingerprint) => `${fingerprint}.json`))
			const removable = snapshots.filter((entry) => !protectedNames.has(entry.name))
			for (const entry of removable.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS))) {
				await fs.unlink(path.join(dir, entry.name))
			}
		})
	writes.set(dir, next)
	const release = () => {
		if (writes.get(dir) === next) writes.delete(dir)
	}
	next.then(release, release)
	return next
}

/** Missing, malformed or mismatched snapshots are unavailable evidence, never a task-resume failure. */
export async function loadSnapshot(taskDir: string, fingerprint: string): Promise<ProjectSnapshot | undefined> {
	try {
		const key = fingerprintSchema.parse(fingerprint)
		const data = snapshotSchema.parse(
			JSON.parse(await fs.readFile(path.resolve(taskDir, SNAPSHOT_DIR, `${key}.json`), "utf8")),
		)
		if (data.fingerprint !== fingerprint) throw new Error("Snapshot fingerprint does not match its file name")
		return data
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			logger.debug("SnapshotStore", "Snapshot unavailable", error)
		return undefined
	}
}
