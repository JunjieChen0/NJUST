// Uses the real (500ms) debounce: the gap between updateHash() and the save is
// exactly what markIncomplete() must close before any points are deleted.

import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { CacheManager } from "../cache-manager"
import { INDEX_INCOMPLETE_HASH } from "../constants"
import { safeWriteJson } from "../../../utils/safeWriteJson"

/** What is on disk, as written by safeWriteJson and read back on startup. */
let disk: Record<string, string> | undefined

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (_path: string, data: Record<string, string>) => {
		disk = JSON.parse(JSON.stringify(data))
	}),
}))

vi.mock("vscode", () => ({
	Uri: { joinPath: vi.fn(() => ({ fsPath: "/mock/storage/cache.json" })) },
	workspace: {
		fs: {
			readFile: vi.fn(async () => {
				if (!disk) throw new Error("ENOENT")
				return Buffer.from(JSON.stringify(disk))
			}),
		},
	},
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

const context = { globalStorageUri: { fsPath: "/mock/storage" } } as vscode.ExtensionContext

/** A fresh process: a new CacheManager loading whatever reached the disk. */
async function restart(): Promise<CacheManager> {
	const manager = new CacheManager(context, "/mock/workspace")
	await manager.initialize()
	return manager
}

describe("CacheManager durability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		disk = { "a.ts": "hash-a" }
	})

	it("loses a plain updateHash() if the process stops before the debounced save", async () => {
		const manager = await restart()
		manager.updateHash("a.ts", "hash-b")

		const afterCrash = await restart()

		expect(afterCrash.getHash("a.ts")).toBe("hash-a")
	})

	it("has the incomplete marker on disk once markIncomplete() resolves", async () => {
		const manager = await restart()
		await manager.markIncomplete(["a.ts", "b.ts"])

		const afterCrash = await restart()

		expect(afterCrash.getHash("a.ts")).toBe(INDEX_INCOMPLETE_HASH)
		expect(afterCrash.getHash("b.ts")).toBe(INDEX_INCOMPLETE_HASH)
	})

	it("rejects when the marker cannot be saved", async () => {
		const manager = await restart()
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("disk full"))

		await expect(manager.markIncomplete(["a.ts"])).rejects.toThrow("disk full")
	})

	it("shares saves between concurrent callers and persists all of their markers", async () => {
		const manager = await restart()

		await Promise.all(["a.ts", "b.ts", "c.ts", "d.ts"].map((file) => manager.markIncomplete([file])))

		expect(vi.mocked(safeWriteJson).mock.calls.length).toBeLessThanOrEqual(2)
		const afterCrash = await restart()
		for (const file of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
			expect(afterCrash.getHash(file)).toBe(INDEX_INCOMPLETE_HASH)
		}
	})
})
