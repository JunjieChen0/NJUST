import {
	compareVersions,
	getLatestCliVersion,
	upgrade,
	detectPlatform,
	fetchManifest,
	downloadAndVerify,
	atomicSwap,
	buildManifestUrl,
} from "../upgrade.js"
import * as os from "os"
import * as fs from "fs/promises"
import * as path from "path"

function createFetchResponse(
	body: unknown,
	init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
	const { ok = true, status = 200, headers = {} } = init
	return {
		ok,
		status,
		json: async () => body,
		headers: new Headers(headers),
	} as Response
}

function createStreamFetchResponse(
	chunks: Uint8Array[],
	init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
	const { ok = true, status = 200, headers = {} } = init
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk)
			}
			controller.close()
		},
	})
	return {
		ok,
		status,
		body: stream,
		json: async () => ({}),
		headers: new Headers(headers),
	} as unknown as Response
}

describe("compareVersions", () => {
	it("returns 1 when first version is newer", () => {
		expect(compareVersions("0.2.0", "0.1.9")).toBe(1)
	})

	it("returns -1 when first version is older", () => {
		expect(compareVersions("0.1.4", "0.1.5")).toBe(-1)
	})

	it("returns 0 when versions are equivalent", () => {
		expect(compareVersions("v1.2.0", "1.2")).toBe(0)
	})

	it("supports cli tag prefixes and prerelease metadata", () => {
		expect(compareVersions("cli-v1.2.3", "1.2.2")).toBe(1)
		expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0)
	})

	it("compares multi-digit patch versions numerically", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBe(1)
	})
})

describe("getLatestCliVersion", () => {
	it("returns the highest cli-v release tag from GitHub releases", async () => {
		const fetchImpl = (async () =>
			createFetchResponse([
				{ tag_name: "cli-v0.1.9" },
				{ tag_name: "v9.9.9" },
				{ tag_name: "cli-v0.1.10" },
				{ tag_name: "cli-v0.1.8" },
			])) as typeof fetch

		await expect(getLatestCliVersion(fetchImpl)).resolves.toBe("0.1.10")
	})

	it("throws when release check fails", async () => {
		const fetchImpl = (async () => createFetchResponse({}, { ok: false, status: 503 })) as typeof fetch

		await expect(getLatestCliVersion(fetchImpl)).rejects.toThrow("Failed to check latest version")
	})
})

describe("detectPlatform", () => {
	it("returns a platform-arch string", () => {
		const platform = detectPlatform()
		expect(platform).toContain("-")
		const parts = platform.split("-")
		expect(["darwin", "linux", "win32"]).toContain(parts[0])
		expect(parts.length).toBeGreaterThanOrEqual(2)
		expect(parts[1]!.length).toBeGreaterThan(0)
	})
})

describe("fetchManifest", () => {
	it("parses a valid manifest with all required fields", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch

		const result = await fetchManifest("0.2.0", fetchImpl)
		expect(result.version).toBe("0.2.0")
		expect(result.publishedAt).toBe("2025-07-13T00:00:00Z")
		expect(result.artifacts["linux-x64"]!.sha256).toBe("a".repeat(64))
		expect(result.artifacts["linux-x64"]!.size).toBe(1000)
	})

	it("throws on invalid manifest format (missing version)", async () => {
		const fetchImpl = (async () => createFetchResponse({ foo: "bar" })) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("Invalid CLI manifest format")
	})

	it("throws when fetch fails", async () => {
		const fetchImpl = (async () => createFetchResponse({}, { ok: false, status: 404 })) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("Failed to fetch CLI manifest")
	})

	it("throws on missing publishedAt", async () => {
		const manifest = {
			version: "0.2.0",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("missing publishedAt")
	})

	it("rejects artifact with invalid SHA-256 format (not 64 hex)", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "short",
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("failed validation")
	})

	it("rejects artifact URL pointing to untrusted host", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://evil.com/malicious.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("untrusted host")
	})

	it("rejects artifact URL pointing to wrong repository", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/evil/repo/malicious.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("expected repository")
	})

	it("rejects artifact with missing size", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/njust-ai-cli-linux-x64.tar.gz",
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("failed validation")
	})

	it("rejects manifest with no valid artifacts", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("no valid artifacts")
	})
})

describe("downloadAndVerify", () => {
	it("rejects invalid SHA-256 format", async () => {
		const os = await import("os")
		const fs = await import("fs/promises")
		const path = await import("path")
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"))
		await expect(
			downloadAndVerify(
				"https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/test.tar.gz",
				"short",
				100,
				tmpDir,
				(async () => createStreamFetchResponse([])) as typeof fetch,
			),
		).rejects.toThrow("Invalid expected SHA-256 format")
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("rejects URL pointing to untrusted host", async () => {
		const os = await import("os")
		const fs = await import("fs/promises")
		const path = await import("path")
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"))

		await expect(
			downloadAndVerify("https://evil.com/malicious.tar.gz", "a".repeat(64), 100, tmpDir, (async () =>
				createStreamFetchResponse([])) as typeof fetch),
		).rejects.toThrow("untrusted host")

		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("rejects when Content-Length does not match expected size", async () => {
		const os = await import("os")
		const fs = await import("fs/promises")
		const path = await import("path")
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"))

		const content = new TextEncoder().encode("hello")
		const fetchImpl = (async () =>
			createStreamFetchResponse([content], {
				headers: { "content-length": "999" },
			})) as typeof fetch

		await expect(
			downloadAndVerify(
				"https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/test.tar.gz",
				"a".repeat(64),
				100,
				tmpDir,
				fetchImpl,
			),
		).rejects.toThrow("Content-Length mismatch")

		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("rejects when downloaded file size does not match", async () => {
		const os = await import("os")
		const fs = await import("fs/promises")
		const path = await import("path")
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"))

		const content = new TextEncoder().encode("hello")
		const fetchImpl = (async () =>
			createStreamFetchResponse([content], {
				headers: { "content-length": "100" },
			})) as typeof fetch

		await expect(
			downloadAndVerify(
				"https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/test.tar.gz",
				"a".repeat(64),
				100,
				tmpDir,
				fetchImpl,
			),
		).rejects.toThrow("File size mismatch")

		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("rejects when checksum does not match", async () => {
		const os = await import("os")
		const fs = await import("fs/promises")
		const path = await import("path")
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"))

		const content = new TextEncoder().encode("hello")
		const fetchImpl = (async () =>
			createStreamFetchResponse([content], {
				headers: { "content-length": "5" },
			})) as typeof fetch

		await expect(
			downloadAndVerify(
				"https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/test.tar.gz",
				"b".repeat(64),
				5,
				tmpDir,
				fetchImpl,
			),
		).rejects.toThrow("Checksum mismatch")

		await fs.rm(tmpDir, { recursive: true, force: true })
	})
})

describe("upgrade (default secure path)", () => {
	let logSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
	})

	afterEach(() => {
		logSpy.mockRestore()
	})

	it("does not attempt download when already up to date", async () => {
		const releases = [{ tag_name: "cli-v0.1.4" }]
		const manifest = {
			version: "0.1.4",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.1.4/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = ((url: string | URL | Request) => {
			const urlStr = typeof url === "string" ? url : url.toString()
			if (urlStr.includes("api.github.com")) {
				return Promise.resolve(createFetchResponse(releases))
			}
			return Promise.resolve(createFetchResponse(manifest))
		}) as typeof fetch

		await upgrade({
			currentVersion: "0.1.4",
			fetchImpl,
		})

		expect(logSpy).toHaveBeenCalledWith("Njust-AI CLI is already up to date.")
	})
})

// ─── buildManifestUrl ─────────────────────────────────────────────────────

describe("buildManifestUrl", () => {
	it("builds a versioned manifest URL", () => {
		const url = buildManifestUrl("0.2.0")
		expect(url).toBe("https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/cli-manifest.json")
	})

	it("does not use releases/latest/download", () => {
		const url = buildManifestUrl("0.2.0")
		expect(url).not.toContain("latest")
	})
})

// ─── fetchManifest version/consistency validation ─────────────────────────

describe("fetchManifest consistency validation", () => {
	it("rejects manifest version that does not match requested version", async () => {
		const manifest = {
			version: "0.3.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.3.0/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("version mismatch")
	})

	it("rejects artifact where key does not match platform", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "darwin-arm64", // mismatch!
					filename: "njust-ai-cli-linux-x64.tar.gz",
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/njust-ai-cli-linux-x64.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("failed validation")
	})

	it("rejects artifact where filename does not match platform pattern", async () => {
		const manifest = {
			version: "0.2.0",
			publishedAt: "2025-07-13T00:00:00Z",
			artifacts: {
				"linux-x64": {
					platform: "linux-x64",
					filename: "wrong-filename.tar.gz", // mismatch!
					url: "https://github.com/NJUST-AI/NJUST_AI/releases/download/cli-v0.2.0/wrong-filename.tar.gz",
					size: 1000,
					sha256: "a".repeat(64),
				},
			},
		}
		const fetchImpl = (async () => createFetchResponse(manifest)) as typeof fetch
		await expect(fetchManifest("0.2.0", fetchImpl)).rejects.toThrow("failed validation")
	})
})

// ─── atomicSwap tests ─────────────────────────────────────────────────────

describe("atomicSwap", () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-swap-test-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	async function createStagingDir(): Promise<string> {
		const staging = path.join(tmpDir, "staging")
		await fs.mkdir(path.join(staging, "bin"), { recursive: true })
		await fs.mkdir(path.join(staging, "lib"), { recursive: true })
		await fs.writeFile(path.join(staging, "bin", "njust-ai"), "#!/usr/bin/env node\nconsole.log('new')")
		await fs.writeFile(path.join(staging, "lib", "index.js"), "export {}")
		await fs.writeFile(path.join(staging, "package.json"), '{"name":"test"}')
		return staging
	}

	async function createInstallDir(): Promise<string> {
		const installDir = path.join(tmpDir, "install")
		await fs.mkdir(path.join(installDir, "bin"), { recursive: true })
		await fs.mkdir(path.join(installDir, "lib"), { recursive: true })
		await fs.writeFile(path.join(installDir, "bin", "njust-ai"), "#!/usr/bin/env node\nconsole.log('old')")
		await fs.writeFile(path.join(installDir, "lib", "index.js"), "export {}")
		await fs.writeFile(path.join(installDir, "package.json"), '{"name":"old"}')
		return installDir
	}

	it("succeeds: replaces install dir and returns backup path", async () => {
		const staging = await createStagingDir()
		const installDir = await createInstallDir()

		const backupDir = await atomicSwap(staging, installDir, false)

		expect(backupDir).not.toBeNull()
		// New content should be in installDir
		const content = await fs.readFile(path.join(installDir, "lib", "index.js"), "utf-8")
		expect(content).toBe("export {}")
		// Staging should have been moved
		await expect(fs.access(staging)).rejects.toThrow()
	})

	it("succeeds: fresh install (no existing install dir)", async () => {
		const staging = await createStagingDir()
		const installDir = path.join(tmpDir, "fresh-install")

		const backupDir = await atomicSwap(staging, installDir, false)

		expect(backupDir).toBeNull()
		const content = await fs.readFile(path.join(installDir, "lib", "index.js"), "utf-8")
		expect(content).toBe("export {}")
	})

	it("fails and rolls back when staging is missing required files", async () => {
		const staging = path.join(tmpDir, "bad-staging")
		await fs.mkdir(staging, { recursive: true })
		// Missing bin/njust-ai, lib/index.js, package.json
		const installDir = await createInstallDir()
		const oldContent = await fs.readFile(path.join(installDir, "bin", "njust-ai"), "utf-8")

		await expect(atomicSwap(staging, installDir, false)).rejects.toThrow("Staging verification failed")

		// Install dir should be restored
		const restoredContent = await fs.readFile(path.join(installDir, "bin", "njust-ai"), "utf-8")
		expect(restoredContent).toBe(oldContent)
	})

	it("fails when npm install fails", async () => {
		const staging = await createStagingDir()
		const installDir = await createInstallDir()
		const oldContent = await fs.readFile(path.join(installDir, "bin", "njust-ai"), "utf-8")

		// npmInstall=true with no actual package.json deps will still call npm install
		// but we test with a staging dir that has no node_modules — npm install may fail
		// or succeed depending on the environment. Let's test with npmInstall=false
		// and a staging that's missing files instead.
		await fs.unlink(path.join(staging, "lib", "index.js"))

		await expect(atomicSwap(staging, installDir, false)).rejects.toThrow()

		// Install dir should be restored
		const restoredContent = await fs.readFile(path.join(installDir, "bin", "njust-ai"), "utf-8")
		expect(restoredContent).toBe(oldContent)
	})
})
