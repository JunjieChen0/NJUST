import { describe, it, expect, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { createHash } from "crypto"
import { computeProjectFingerprint, computeProjectSnapshot, discoverProjectRoots } from "../projectFingerprint"

async function write(root: string, rel: string, content: string): Promise<void> {
	const filePath = path.join(root, rel)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content, "utf8")
}

describe("computeProjectFingerprint", () => {
	let base: string
	let root: string

	beforeEach(async () => {
		base = await fs.mkdtemp(path.join(os.tmpdir(), "cj-fp-"))
		root = path.join(base, "app")
		await write(root, "cjpm.toml", '[package]\nname = "app"\n')
		await write(root, "src/main.cj", "main() {}\n")
	})

	afterEach(async () => {
		await fs.rm(base, { recursive: true, force: true })
	})

	it("is stable for unchanged inputs", async () => {
		const first = await computeProjectFingerprint(root)

		expect(first).toMatch(/^[0-9a-f]{64}$/)
		await expect(computeProjectFingerprint(root)).resolves.toBe(first)
	})

	it("uses the same relative input paths through a symlinked project directory", async () => {
		const alias = path.join(base, "project-alias")
		await fs.symlink(root, alias, process.platform === "win32" ? "junction" : "dir")
		await expect(computeProjectSnapshot(alias)).resolves.toEqual(await computeProjectSnapshot(root))
	})

	it("returns relative input paths and their exact content hashes", async () => {
		const snapshot = await computeProjectSnapshot(root)

		expect(snapshot?.files).toEqual({
			"cjpm.toml": createHash("sha256").update('[package]\nname = "app"\n').digest("hex"),
			"src/main.cj": createHash("sha256").update("main() {}\n").digest("hex"),
		})
		await expect(computeProjectFingerprint(root)).resolves.toBe(snapshot?.fingerprint)
	})

	it.each([
		["a source edit", () => write(root, "src/main.cj", 'main() { println("x") }\n')],
		["a new untracked source file", () => write(root, "src/extra.cj", "func f() {}\n")],
		["a manifest edit", () => write(root, "cjpm.toml", '[package]\nname = "app2"\n')],
		["a lock file", () => write(root, "cjpm.lock", "lock\n")],
		["a rename", () => fs.rename(path.join(root, "src/main.cj"), path.join(root, "src/entry.cj"))],
	])("changes after %s", async (_label, mutate) => {
		const before = await computeProjectFingerprint(root)
		await mutate()

		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})

	it.each([
		["build output", "target/release/bin/main.cj"],
		["git metadata", ".git/HEAD"],
		["extension state", ".njust_ai/memrl/episodes.json"],
		["extension symbol index", ".cangjie-index/symbols.json"],
		["extension completion audit", ".njust-ai/cangjie-eval-trace.jsonl"],
	])("ignores %s", async (_label, rel) => {
		const before = await computeProjectFingerprint(root)
		await write(root, rel, "noise")

		await expect(computeProjectFingerprint(root)).resolves.toBe(before)
	})

	it("still fingerprints other files beside the extension's completion audit", async () => {
		const before = await computeProjectFingerprint(root)
		await write(root, ".njust-ai/project-config.json", "project input")
		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})

	it("still fingerprints a source package that happens to be named target below the root", async () => {
		await write(root, "src/target/model.cj", "package app.target\n")
		const before = await computeProjectFingerprint(root)

		await write(root, "src/target/model.cj", "package app.target\nfunc f() {}\n")

		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})

	it("follows symlinked source files", async () => {
		await write(base, "shared/util.cj", "func u() {}\n")
		try {
			await fs.symlink(path.join(base, "shared", "util.cj"), path.join(root, "src", "util.cj"), "file")
		} catch {
			return // symlinks need extra privileges on some Windows setups
		}
		const before = await computeProjectFingerprint(root)

		await write(base, "shared/util.cj", "func u() { 1 }\n")

		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})

	it("includes local path dependencies declared in cjpm.toml", async () => {
		await write(base, "lib/cjpm.toml", '[package]\nname = "lib"\n')
		await write(base, "lib/src/lib.cj", "package lib\n")
		await write(root, "cjpm.toml", '[package]\nname = "app"\n[dependencies]\nlib = { path = "../lib" }\n')
		const before = await computeProjectFingerprint(root)

		await write(base, "lib/src/lib.cj", "package lib\npublic func g() {}\n")

		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})

	it.each(["native", "../native"])(
		"hashes FFI inputs at %s without treating them as cjpm projects",
		async (nativePath) => {
			await write(root, "cjpm.toml", `[package]\nname="app"\n[ffi.c]\nhello={path="${nativePath}"}\n`)
			const native = path.resolve(root, nativePath)
			await write(native, "hello.c", "int hello() { return 1; }\n")
			await write(native, "target/libhello.a", "native library")
			const before = await computeProjectSnapshot(root)
			expect(before?.coverage).toBe("complete")
			expect(before?.gaps).toEqual([])
			expect(await discoverProjectRoots(root)).toEqual(new Set([await fs.realpath(root)]))
			await write(native, "target/libhello.a", "changed native library")
			await expect(computeProjectFingerprint(root)).resolves.not.toBe(before?.fingerprint)
		},
	)

	it("does not turn other path settings into cjpm projects", async () => {
		await write(root, "cjpm.toml", '[package]\nname="app"\n[profile.customized-option]\npath="not-a-project"\n')
		expect((await computeProjectSnapshot(root))?.coverage).toBe("complete")
	})

	it.each(["dependencies", "test-dependencies", "script-dependencies", "replace"])(
		"follows %s in root and target configurations",
		async (section) => {
			for (const dependency of ["lib", "platform", "debug"]) {
				await write(base, `${dependency}/cjpm.toml`, `[package]\nname="${dependency}"\n`)
				await write(base, `${dependency}/src/lib.cj`, `package ${dependency}\n`)
			}
			await write(
				root,
				"cjpm.toml",
				`[package]\nname="app"\n[${section}]\nlib={path="../lib"}\n[target.x86_64-w64-mingw32.${section}]\nplatform={path="../platform"}\n[target.x86_64-w64-mingw32.debug.${section}]\ndebug={path="../debug"}\n`,
			)
			const snapshot = await computeProjectSnapshot(root)
			expect(snapshot?.coverage).toBe("complete")
			for (const dependency of ["lib", "platform", "debug"]) {
				expect(snapshot?.files).toHaveProperty(`../${dependency}/src/lib.cj`)
			}
		},
	)

	it("keeps missing source dependencies and native inputs as coverage gaps", async () => {
		await write(
			root,
			"cjpm.toml",
			'[package]\nname="app"\n[dependencies]\nlib={path="../missing-source"}\n[ffi.c]\nhello={path="../missing-native"}\n',
		)
		const snapshot = await computeProjectSnapshot(root)
		expect(snapshot?.coverage).toBe("partial")
		expect(snapshot?.gaps).toContainEqual(expect.stringContaining("missing-source"))
		expect(snapshot?.gaps).toContainEqual(expect.stringContaining("missing-native"))
	})
	it("still requires a manifest for an existing source dependency directory", async () => {
		await write(base, "lib/src/lib.cj", "package lib\n")
		await write(root, "cjpm.toml", '[package]\nname="app"\n[dependencies]\nlib={path="../lib"}\n')
		const snapshot = await computeProjectSnapshot(root)
		expect(snapshot?.coverage).toBe("partial")
		expect(snapshot?.gaps).toContainEqual(expect.stringContaining(path.join("lib", "cjpm.toml")))
	})

	it("returns undefined when the project root has no manifest", async () => {
		await expect(computeProjectFingerprint(path.join(base, "missing"))).resolves.toBeUndefined()
	})

	it("includes workspace members and their external dependencies transitively", async () => {
		await write(root, "cjpm.toml", '[workspace]\nmembers = ["members/*"]\n')
		await write(
			root,
			"members/app/cjpm.toml",
			'[package]\nname="member"\n[dependencies]\nlib={path="../../../lib"}\n',
		)
		await write(base, "lib/cjpm.toml", '[package]\nname="lib"\n')
		await write(base, "lib/src/lib.cj", "package lib\n")
		const before = await computeProjectSnapshot(root)
		expect(before?.coverage).toBe("complete")
		await write(base, "lib/src/lib.cj", "package lib\npublic func changed() {}\n")
		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before?.fingerprint)
		const stable = await computeProjectFingerprint(root)
		await write(root, "members/app/target/output.bin", "generated")
		await expect(computeProjectFingerprint(root)).resolves.toBe(stable)
	})

	it("fingerprints test data, resource files and native sources", async () => {
		for (const file of ["testdata/cases.json", "assets/template.txt", "native/ffi.c"]) {
			const before = await computeProjectFingerprint(root)
			await write(root, file, "new input")
			await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
		}
	})

	it.each(["missing member", "invalid manifest"])("records partial coverage for %s", async (reason) => {
		await write(root, "cjpm.toml", reason === "missing member" ? '[workspace]\nmembers=["missing"]' : "[invalid")
		const snapshot = await computeProjectSnapshot(root)
		expect(snapshot?.coverage).toBe("partial")
		expect(snapshot?.gaps.length).toBeGreaterThan(0)
	})

	it("marks metadata-only coverage as incomplete for files larger than five MB", async () => {
		const file = path.join(root, "large.bin")
		await fs.writeFile(file, Buffer.alloc(6 * 1024 * 1024))
		const before = await computeProjectSnapshot(root)
		expect(before?.coverage).toBe("partial")
		expect(before?.gaps).toContainEqual(expect.stringContaining("large.bin"))
		await fs.utimes(file, new Date(1000), new Date(1000))
		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before?.fingerprint)
	})

	it.each(["'../lib'", '"../li\\u0062"'])(
		"includes a TOML path dependency declared as %s",
		async (dependencyPath) => {
			await write(base, "lib/cjpm.toml", '[package]\nname = "lib"\n')
			await write(base, "lib/src/lib.cj", "package lib\n")
			await write(
				root,
				"cjpm.toml",
				`[package]\nname = "app"\n[dependencies]\nlib = { path = ${dependencyPath} }\n`,
			)
			const before = await computeProjectFingerprint(root)

			await write(base, "lib/src/lib.cj", "package lib\npublic func g() {}\n")

			expect(before).toBeDefined()
			await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
		},
	)

	it("includes transitive path dependencies", async () => {
		await write(root, "cjpm.toml", "[package]\nname = \"app\"\n[dependencies]\nlib = { path = '../lib' }\n")
		await write(base, "lib/cjpm.toml", "[package]\nname = \"lib\"\n[dependencies]\nleaf = { path = '../leaf' }\n")
		await write(base, "leaf/cjpm.toml", '[package]\nname = "leaf"\n')
		await write(base, "leaf/src/leaf.cj", "package leaf\n")
		const before = await computeProjectFingerprint(root)

		await write(base, "leaf/src/leaf.cj", "package leaf\npublic func f() {}\n")

		expect(before).toBeDefined()
		await expect(computeProjectFingerprint(root)).resolves.not.toBe(before)
	})
})
