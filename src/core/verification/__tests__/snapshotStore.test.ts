import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { loadSnapshot, saveSnapshot } from "../snapshotStore"

describe("snapshotStore", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "cj-snapshots-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("round-trips a snapshot and refreshes an existing fingerprint without rewriting its contents", async () => {
		const snapshot = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "fp-1",
			files: { "src/main.cj": "hash" },
		}
		await saveSnapshot(dir, snapshot)
		const file = path.join(dir, "verification-snapshots", "fp-1.json")
		await fs.utimes(file, new Date(1000), new Date(1000))
		await saveSnapshot(dir, snapshot)

		expect((await fs.stat(file)).mtimeMs).toBeGreaterThan(1000)
		await expect(loadSnapshot(dir, "fp-1")).resolves.toEqual(snapshot)
	})

	it("keeps a reused snapshot when pruning the oldest entry", async () => {
		for (let i = 0; i < 30; i++) {
			await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: `fp-${i}`, files: {} })
			await fs.utimes(
				path.join(dir, "verification-snapshots", `fp-${i}.json`),
				new Date(1000 + i),
				new Date(1000 + i),
			)
		}
		await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: "fp-0", files: {} })
		await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: "fp-new", files: {} })
		await expect(loadSnapshot(dir, "fp-0")).resolves.toBeDefined()
		await expect(loadSnapshot(dir, "fp-1")).resolves.toBeUndefined()
	})

	it("preserves keep fingerprints across 31 new snapshots while respecting the retention limit", async () => {
		const snapshot = {
			coverage: "complete" as const,
			gaps: [],
			fingerprint: "delivery",
			files: { "src/main.cj": "hash" },
		}
		await saveSnapshot(dir, snapshot)
		await saveSnapshot(dir, snapshot)
		const file = path.join(dir, "verification-snapshots", "delivery.json")
		await fs.utimes(file, new Date(1000), new Date(1000))
		for (let i = 0; i < 31; i++) {
			await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: `new-${i}`, files: {} }, [
				"delivery",
			])
		}
		await expect(loadSnapshot(dir, "delivery")).resolves.toEqual(snapshot)
		expect(await fs.readdir(path.join(dir, "verification-snapshots"))).toHaveLength(30)
	})

	it("returns undefined for missing, corrupt, mismatched, and invalid snapshot paths", async () => {
		await expect(loadSnapshot(dir, "missing")).resolves.toBeUndefined()
		await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: "broken", files: {} })
		await fs.writeFile(path.join(dir, "verification-snapshots", "broken.json"), "{bad")
		await expect(loadSnapshot(dir, "broken")).resolves.toBeUndefined()
		await fs.writeFile(
			path.join(dir, "verification-snapshots", "broken.json"),
			JSON.stringify({ coverage: "complete" as const, gaps: [], fingerprint: "other", files: {} }),
		)
		await expect(loadSnapshot(dir, "broken")).resolves.toBeUndefined()
		await expect(loadSnapshot(dir, "../escape")).resolves.toBeUndefined()
	})

	it("keeps the newest 30 snapshots without touching other task data", async () => {
		await fs.writeFile(path.join(dir, "keep.json"), "user task data")
		for (let i = 0; i < 31; i++) {
			await saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: `fp-${i}`, files: {} })
			await fs.utimes(
				path.join(dir, "verification-snapshots", `fp-${i}.json`),
				new Date(1000 + i),
				new Date(1000 + i),
			)
		}
		expect(await fs.readdir(path.join(dir, "verification-snapshots"))).toHaveLength(30)
		await expect(loadSnapshot(dir, "fp-0")).resolves.toBeUndefined()
		await expect(loadSnapshot(dir, "fp-30")).resolves.toBeDefined()
		await expect(fs.readFile(path.join(dir, "keep.json"), "utf8")).resolves.toBe("user task data")
	})

	it("serializes concurrent saves of the same fingerprint", async () => {
		await Promise.all(
			Array.from({ length: 5 }, () =>
				saveSnapshot(dir, { coverage: "complete" as const, gaps: [], fingerprint: "same", files: {} }),
			),
		)
		expect(await fs.readdir(path.join(dir, "verification-snapshots"))).toEqual(["same.json"])
	})
})
