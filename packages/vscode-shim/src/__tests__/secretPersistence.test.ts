import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import * as childProcess from "child_process"
import { FileSecretStorage } from "../storage/SecretStorage.js"

vi.mock("fs", async (original) => ({ ...(await original<typeof fs>()) }))
vi.mock("child_process", async (original) => ({ ...(await original<typeof childProcess>()) }))

describe("secret persistence failures", () => {
	let root: string
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-persist-"))
	})
	afterEach(() => {
		vi.restoreAllMocks()
	}) // Keep failed-write artifacts available for inspection.
	it.each(["store", "delete", "clear"])(
		"keeps old data and emits no change when %s cannot publish",
		async (operation) => {
			const storage = new FileSecretStorage(root)
			await storage.store("key", "old")
			const file = path.join(root, "secrets.json")
			const before = fs.readFileSync(file)
			const event = vi.fn()
			storage.onDidChange(event)
			vi.spyOn(fs, "renameSync").mockImplementation(() => {
				throw new Error("disk failure")
			})
			const invoke = async () =>
				operation === "store"
					? storage.store("key", "new")
					: operation === "delete"
						? storage.delete("key")
						: storage.clearAll()
			await expect(invoke()).rejects.toThrow("disk failure")
			expect(await storage.get("key")).toBe("old")
			expect(event).not.toHaveBeenCalled()
			expect(fs.readFileSync(file)).toEqual(before)
			expect(await new FileSecretStorage(root).get("key")).toBe("old")
		},
	)
	it("does not cache a key that failed to persist", async () => {
		const storage = new FileSecretStorage(root)
		const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
			throw new Error("key write failed")
		})
		await expect(storage.store("key", "first")).rejects.toThrow("key write failed")
		expect(await storage.get("key")).toBeUndefined()
		expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false)
		rename.mockRestore()
		await storage.store("key", "second")
		expect(await new FileSecretStorage(root).get("key")).toBe("second")
	})
	it.skipIf(process.platform !== "win32")(
		"leaves only empty temporary files if protecting the key fails",
		async () => {
			vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
				throw new Error("ACL denied")
			})
			const storage = new FileSecretStorage(root)
			await expect(storage.store("key", "new")).rejects.toThrow("ACL denied")
			expect(await storage.get("key")).toBeUndefined()
			for (const file of fs.readdirSync(root)) expect(fs.statSync(path.join(root, file)).size).toBe(0)
		},
	)
	it("recovers legacy data when migration was interrupted after its random key was saved", async () => {
		const legacy = crypto.scryptSync(
			`${os.userInfo().username}@${os.hostname()}:${process.platform}`,
			"njust-ai-secret-storage-v1",
			32,
		)
		const iv = crypto.randomBytes(16)
		const cipher = crypto.createCipheriv("aes-256-gcm", legacy, iv)
		const encrypted = Buffer.concat([cipher.update(JSON.stringify({ key: "original" }), "utf8"), cipher.final()])
		const file = path.join(root, "secrets.json")
		fs.writeFileSync(file, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"))
		const before = fs.readFileSync(file)
		const rename = fs.renameSync
		const spy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
			if (target === file) throw new Error("migration interrupted")
			return rename(source, target)
		})
		expect(() => new FileSecretStorage(root)).toThrow("migration interrupted")
		expect(fs.readFileSync(file)).toEqual(before)
		spy.mockRestore()
		expect(await new FileSecretStorage(root).get("key")).toBe("original")
		expect(await new FileSecretStorage(root).get("key")).toBe("original")
	})
})
