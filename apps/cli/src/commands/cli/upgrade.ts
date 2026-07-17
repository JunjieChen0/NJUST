import { spawn } from "child_process"
import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as os from "os"

import { VERSION } from "@/lib/utils/version.js"
import { isRecord } from "@/lib/utils/guards.js"

const RELEASES_URL = "https://api.github.com/repos/NJUST-AI/NJUST_AI/releases?per_page=100"
const RELEASES_DOWNLOAD_BASE = "https://github.com/NJUST-AI/NJUST_AI/releases/download"
const ALLOWED_HOSTS = new Set(["github.com", "objects.githubusercontent.com"])
const ALLOWED_REPO_PATH_PREFIX = "/NJUST-AI/NJUST_AI/"
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const MAX_TARBALL_SIZE = 500 * 1024 * 1024

export interface UpgradeOptions {
	currentVersion?: string
	fetchImpl?: typeof fetch
}

export interface SecureUpgradeOptions {
	currentVersion?: string
	fetchImpl?: typeof fetch
	installDir?: string
	binDir?: string
	npmInstall?: boolean
}

export interface CliManifestArtifact {
	platform: string
	filename: string
	url: string
	size: number
	sha256: string
}

export interface CliManifest {
	version: string
	publishedAt: string
	artifacts: Record<string, CliManifestArtifact>
}

function parseVersion(version: string): number[] {
	const cleaned = version
		.trim()
		.replace(/^cli-v/, "")
		.replace(/^v/, "")
	const core = cleaned.split("+", 1)[0]?.split("-", 1)[0]

	if (!core) {
		throw new Error(`Invalid version: ${version}`)
	}

	const parts = core.split(".")
	if (parts.length === 0) {
		throw new Error(`Invalid version: ${version}`)
	}

	return parts.map((part) => {
		if (!/^\d+$/.test(part)) {
			throw new Error(`Invalid version: ${version}`)
		}

		return Number.parseInt(part, 10)
	})
}

export function compareVersions(a: string, b: string): number {
	const aParts = parseVersion(a)
	const bParts = parseVersion(b)
	const maxLength = Math.max(aParts.length, bParts.length)

	for (let i = 0; i < maxLength; i++) {
		const aPart = aParts[i] ?? 0
		const bPart = bParts[i] ?? 0

		if (aPart > bPart) {
			return 1
		}

		if (aPart < bPart) {
			return -1
		}
	}

	return 0
}

export async function getLatestCliVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
	const response = await fetchImpl(RELEASES_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "njust-ai-cli",
		},
	})

	if (!response.ok) {
		throw new Error(`Failed to check latest version (HTTP ${response.status})`)
	}

	const releases = await response.json()
	if (!Array.isArray(releases)) {
		throw new Error("Invalid release response from GitHub.")
	}

	let latestVersion: string | undefined

	for (const release of releases) {
		if (!isRecord(release)) {
			continue
		}

		const tagName = release.tag_name
		if (typeof tagName === "string" && tagName.startsWith("cli-v")) {
			const candidate = tagName.slice("cli-v".length)
			try {
				if (!latestVersion || compareVersions(candidate, latestVersion) > 0) {
					latestVersion = candidate
				}
			} catch {
				// Ignore malformed CLI tags and keep scanning other releases.
			}
		}
	}

	if (latestVersion) {
		return latestVersion
	}

	throw new Error("Could not determine the latest CLI release version.")
}

export function detectPlatform(): string {
	return `${process.platform}-${process.arch}`
}

function validateArtifactUrl(url: string): void {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`Invalid artifact URL: ${url}`)
	}

	if (!ALLOWED_HOSTS.has(parsed.hostname)) {
		throw new Error(`Artifact URL points to untrusted host: ${parsed.hostname}`)
	}

	if (!parsed.pathname.startsWith(ALLOWED_REPO_PATH_PREFIX)) {
		throw new Error(`Artifact URL does not point to expected repository: ${parsed.pathname}`)
	}
}

function validateManifestArtifact(key: string, raw: unknown): CliManifestArtifact | null {
	if (!isRecord(raw)) return null

	if (typeof raw.platform !== "string" || !raw.platform) return null
	if (typeof raw.filename !== "string" || !raw.filename) return null
	if (typeof raw.url !== "string" || !raw.url) return null
	if (typeof raw.sha256 !== "string" || !SHA256_HEX_PATTERN.test(raw.sha256)) return null
	if (typeof raw.size !== "number" || !Number.isFinite(raw.size) || raw.size <= 0) return null

	validateArtifactUrl(raw.url)

	// Key must match platform
	if (key !== raw.platform) return null

	// Filename must match expected pattern: njust-ai-cli-<platform>.tar.gz
	const expectedFilename = `njust-ai-cli-${raw.platform}.tar.gz`
	if (raw.filename !== expectedFilename) return null

	return {
		platform: raw.platform,
		filename: raw.filename,
		url: raw.url,
		size: raw.size,
		sha256: raw.sha256,
	}
}

/**
 * Build a versioned manifest URL.
 * Uses `releases/download/cli-v<VERSION>/cli-manifest.json` instead of
 * `releases/latest/download` to avoid the prerelease/latest conflict.
 */
export function buildManifestUrl(version: string): string {
	return `${RELEASES_DOWNLOAD_BASE}/cli-v${version}/cli-manifest.json`
}

export async function fetchManifest(version: string, fetchImpl: typeof fetch = fetch): Promise<CliManifest> {
	const manifestUrl = buildManifestUrl(version)

	const response = await fetchImpl(manifestUrl, {
		headers: { "User-Agent": "njust-ai-cli" },
		redirect: "follow",
	})

	if (!response.ok) {
		throw new Error(`Failed to fetch CLI manifest (HTTP ${response.status})`)
	}

	const data = await response.json()
	if (!isRecord(data) || typeof data.version !== "string" || !isRecord(data.artifacts)) {
		throw new Error("Invalid CLI manifest format")
	}

	// Manifest version must match the requested version
	if (data.version !== version) {
		throw new Error(`Manifest version mismatch: expected ${version}, got ${data.version}`)
	}

	if (typeof data.publishedAt !== "string" || !data.publishedAt) {
		throw new Error("Invalid CLI manifest: missing publishedAt")
	}

	const artifacts: Record<string, CliManifestArtifact> = {}
	for (const [key, val] of Object.entries(data.artifacts)) {
		const validated = validateManifestArtifact(key, val)
		if (!validated) {
			throw new Error(`Invalid CLI manifest: artifact "${key}" failed validation`)
		}
		artifacts[key] = validated
	}

	if (Object.keys(artifacts).length === 0) {
		throw new Error("Invalid CLI manifest: no valid artifacts")
	}

	return {
		version: data.version,
		publishedAt: data.publishedAt,
		artifacts,
	}
}

async function computeSha256(filePath: string): Promise<string> {
	const buffer = await fs.readFile(filePath)
	return crypto.createHash("sha256").update(buffer).digest("hex")
}

export async function downloadAndVerify(
	url: string,
	expectedSha256: string,
	expectedSize: number,
	destDir: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	if (!SHA256_HEX_PATTERN.test(expectedSha256)) {
		throw new Error("Invalid expected SHA-256 format")
	}

	validateArtifactUrl(url)

	const response = await fetchImpl(url, {
		headers: { "User-Agent": "njust-ai-cli" },
		redirect: "follow",
	})

	if (!response.ok) {
		throw new Error(`Failed to download tarball (HTTP ${response.status})`)
	}

	if (!response.body) {
		throw new Error("Download response has no body")
	}

	const contentLength = Number(response.headers.get("content-length") ?? 0)
	if (contentLength > 0 && contentLength !== expectedSize) {
		throw new Error(
			`Content-Length mismatch: expected ${expectedSize}, got ${contentLength}`,
		)
	}

	const tarballPath = path.join(destDir, "njust-ai-cli.tar.gz")
	const fileStream = fsSync.createWriteStream(tarballPath)
	const reader = response.body.getReader()

	let totalBytes = 0

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			totalBytes += value.length
			if (totalBytes > MAX_TARBALL_SIZE) {
				fileStream.destroy()
				await fs.unlink(tarballPath).catch(() => {})
				throw new Error(`Download exceeds maximum allowed size (${MAX_TARBALL_SIZE} bytes)`)
			}
			if (!fileStream.write(value)) {
				await new Promise<void>((resolve) => fileStream.once("drain", () => resolve()))
			}
		}
	} catch (err) {
		fileStream.destroy()
		await fs.unlink(tarballPath).catch(() => {})
		throw err
	} finally {
		fileStream.end()
		await new Promise<void>((resolve) => fileStream.on("close", () => resolve()))
	}

	if (totalBytes !== expectedSize) {
		await fs.unlink(tarballPath).catch(() => {})
		throw new Error(
			`File size mismatch: expected ${expectedSize}, got ${totalBytes}`,
		)
	}

	const actualSha256 = await computeSha256(tarballPath)
	if (actualSha256 !== expectedSha256) {
		await fs.unlink(tarballPath).catch(() => {})
		throw new Error(
			`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`,
		)
	}

	return tarballPath
}

/**
 * Verify that a tarball does not contain absolute paths or path traversal (..).
 * Prevents archive extraction from escaping the target directory.
 */
async function verifyTarballPaths(tarballPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("tar", ["-tzf", tarballPath], { stdio: "pipe", shell: process.platform === "win32" })
		const chunks: Buffer[] = []
		child.stdout.on("data", (chunk) => chunks.push(chunk))
		child.once("error", reject)
		child.once("close", (code) => {
			if (code !== 0) {
				reject(new Error(`tar listing failed (exit code ${code})`))
				return
			}
			const listing = Buffer.concat(chunks).toString("utf-8")
			const lines = listing.split("\n").filter(Boolean)
			for (const entry of lines) {
				// After --strip-components=1, check for absolute paths and .. traversal
				if (path.isAbsolute(entry) || entry.includes("..")) {
					reject(new Error(`Tarball contains unsafe path: ${entry}`))
					return
				}
			}
			resolve()
		})
	})
}

async function extractTarball(tarballPath: string, destDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("tar", ["-xzf", tarballPath, "-C", destDir, "--strip-components=1"], {
			stdio: "pipe",
			shell: process.platform === "win32",
		})

		child.once("error", reject)
		child.once("close", (code) => {
			if (code === 0) resolve()
			else reject(new Error(`tar extraction failed (exit code ${code})`))
		})
	})
}

async function runNpmInstall(dir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("npm", ["install", "--production", "--ignore-scripts", "--silent"], {
			cwd: dir,
			stdio: "pipe",
			shell: process.platform === "win32",
		})

		child.once("error", reject)
		child.once("close", (code) => {
			if (code === 0) resolve()
			else reject(new Error(`npm install failed (exit code ${code})`))
		})
	})
}

async function verifyStagingIntegrity(stagingDir: string): Promise<void> {
	const requiredFiles = [
		path.join(stagingDir, "bin", "njust-ai"),
		path.join(stagingDir, "lib", "index.js"),
		path.join(stagingDir, "package.json"),
	]

	for (const file of requiredFiles) {
		try {
			await fs.access(file)
		} catch {
			throw new Error(`Staging verification failed: missing required file ${file}`)
		}
	}
}

/**
 * Perform an atomic swap of the install directory.
 *
 * Transaction steps:
 * 1. npm install in staging
 * 2. Verify staging integrity
 * 3. Rename old install → backup (if exists)
 * 4. Rename staging → install
 *
 * On failure: rolls back by restoring backup.
 * The backup is NOT deleted here — caller must verify health before cleanup.
 *
 * @returns The backup directory path (if one was created), so the caller can
 *          delete it after health verification, or restore it on failure.
 */
export async function atomicSwap(
	sourceDir: string,
	installDir: string,
	npmInstall: boolean,
): Promise<string | null> {
	const backupDir = `${installDir}.backup.${Date.now()}`

	try {
		if (npmInstall) {
			await runNpmInstall(sourceDir)
		}

		await verifyStagingIntegrity(sourceDir)

		let hasBackup = false
		try {
			await fs.access(installDir)
			await fs.rename(installDir, backupDir)
			hasBackup = true
		} catch {
			// installDir doesn't exist, no backup needed
		}

		try {
			await fs.rename(sourceDir, installDir)
		} catch (err) {
			if (hasBackup) {
				await fs.rename(backupDir, installDir).catch(() => {})
			}
			throw err
		}

		return hasBackup ? backupDir : null
	} catch (err) {
		if (await pathExists(backupDir)) {
			await fs.rename(backupDir, installDir).catch(() => {})
		}
		throw err
	}
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p)
		return true
	} catch {
		return false
	}
}

/**
 * Run a minimal health check on the newly installed CLI.
 * Spawns `<installDir>/bin/njust-ai --version` and verifies it exits successfully.
 */
async function runHealthCheck(installDir: string): Promise<void> {
	const binPath = path.join(installDir, "bin", "njust-ai")

	return new Promise((resolve, reject) => {
		const child = spawn(binPath, ["--version"], {
			stdio: "pipe",
			timeout: 15_000,
		})

		let stdout = ""
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString()
		})

		child.once("error", reject)
		child.once("close", (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`Health check failed (exit code ${code}): ${stdout.trim()}`))
			}
		})
	})
}

export async function secureUpgrade(options: SecureUpgradeOptions = {}): Promise<void> {
	const currentVersion = options.currentVersion ?? VERSION
	const fetchImpl = options.fetchImpl ?? fetch
	const installDir = options.installDir ?? process.env.NJUST_AI_INSTALL_DIR ?? path.join(os.homedir(), ".njust-ai", "cli")
	const npmInstall = options.npmInstall ?? true

	console.log(`Current version: ${currentVersion}`)

	// Step 1: Determine latest version from GitHub Releases API
	const latestVersion = await getLatestCliVersion(fetchImpl)
	console.log(`Latest version: ${latestVersion}`)

	if (compareVersions(latestVersion, currentVersion) <= 0) {
		console.log("Njust-AI CLI is already up to date.")
		return
	}

	// Step 2: Fetch versioned manifest
	const manifest = await fetchManifest(latestVersion, fetchImpl)

	// Step 3: Validate manifest version matches
	if (manifest.version !== latestVersion) {
		throw new Error(`Manifest version ${manifest.version} does not match latest release ${latestVersion}`)
	}

	const platform = detectPlatform()
	const artifact = manifest.artifacts[platform]
	if (!artifact) {
		throw new Error(`No CLI artifact available for platform: ${platform}`)
	}

	// Step 4: Validate artifact URL points to the correct release tag
	validateArtifactUrl(artifact.url)
	if (!artifact.url.includes(`/cli-v${latestVersion}/`)) {
		throw new Error(`Artifact URL does not reference expected release cli-v${latestVersion}: ${artifact.url}`)
	}

	// Step 5: Validate artifact key, platform, and filename consistency
	if (artifact.platform !== platform) {
		throw new Error(`Artifact platform mismatch: key says ${platform}, artifact says ${artifact.platform}`)
	}
	const expectedFilename = `njust-ai-cli-${platform}.tar.gz`
	if (artifact.filename !== expectedFilename) {
		throw new Error(`Artifact filename mismatch: expected ${expectedFilename}, got ${artifact.filename}`)
	}

	console.log(`Upgrading Njust-AI CLI from ${currentVersion} to ${manifest.version}...`)
	console.log(`Downloading from ${artifact.url}...`)

	// Create tmpDir in install dir's parent to ensure same filesystem for atomic rename
	const installParent = path.dirname(installDir)
	await fs.mkdir(installParent, { recursive: true })
	const tmpDir = await fs.mkdtemp(path.join(installParent, ".njust-ai-upgrade-"))
	let backupDir: string | null = null

	try {
		// Step 6: Download and verify checksum
		const tarballPath = await downloadAndVerify(
			artifact.url,
			artifact.sha256,
			artifact.size,
			tmpDir,
			fetchImpl,
		)
		console.log("✓ Checksum verified")

		// Step 7: Extract tarball to staging (with path traversal check)
		await verifyTarballPaths(tarballPath)
		const extractDir = path.join(tmpDir, "extracted")
		await fs.mkdir(extractDir, { recursive: true })
		await extractTarball(tarballPath, extractDir)

		const binPath = path.join(extractDir, "bin", "njust-ai")
		await fs.chmod(binPath, 0o755).catch(() => {})

		// Step 8: Save old symlink state (we back up the symlink itself, not its target)
		const binDir = options.binDir ?? process.env.NJUST_AI_BIN_DIR ?? path.join(os.homedir(), ".local", "bin")
		const symlinkPath = path.join(binDir, "njust-ai")
		let oldSymlinkExists = false
		try {
			await fs.lstat(symlinkPath)
			oldSymlinkExists = true
		} catch {
			// No existing symlink
		}

		// Step 9: Atomic swap (backup old install, install new)
		backupDir = await atomicSwap(extractDir, installDir, npmInstall)

		// Step 10: Create new symlink (backup old one first)
		const backupSymlinkPath = `${symlinkPath}.backup.${Date.now()}`
		let hasBackupSymlink = false
		if (oldSymlinkExists) {
			await fs.rename(symlinkPath, backupSymlinkPath)
			hasBackupSymlink = true
		}

		await fs.mkdir(binDir, { recursive: true })
		try {
			await fs.symlink(path.join(installDir, "bin", "njust-ai"), symlinkPath)
		} catch (err) {
			// Restore old symlink if new one fails
			if (hasBackupSymlink) {
				await fs.rename(backupSymlinkPath, symlinkPath).catch(() => {})
			}
			// Rollback install directory too
			if (backupDir) {
				await fs.rename(installDir, `${installDir}.failed.${Date.now()}`).catch(() => {})
				await fs.rename(backupDir, installDir).catch(() => {})
			}
			throw err
		}

		// Step 11: Health check — verify new CLI works
		try {
			await runHealthCheck(installDir)
			console.log("✓ Health check passed")
		} catch (err) {
			// Health check failed — rollback everything
			console.error("Health check failed, rolling back...")

			// Restore old symlink
			try {
				await fs.unlink(symlinkPath)
			} catch {
				// ignore
			}
			if (hasBackupSymlink) {
				await fs.rename(backupSymlinkPath, symlinkPath).catch(() => {})
			}

			// Restore old install directory
			if (backupDir) {
				await fs.rename(installDir, `${installDir}.failed.${Date.now()}`).catch(() => {})
				await fs.rename(backupDir, installDir).catch(() => {})
			}
			throw err
		}

		// Step 12: All good — clean up backups
		if (backupDir) {
			await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
		}
		if (hasBackupSymlink) {
			await fs.unlink(backupSymlinkPath).catch(() => {})
		}

		console.log("✓ Upgrade completed.")
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	}
}

export async function upgrade(options: UpgradeOptions = {}): Promise<void> {
	const currentVersion = options.currentVersion ?? VERSION

	console.log(`Current version: ${currentVersion}`)

	const secureOptions: SecureUpgradeOptions = {
		currentVersion,
		fetchImpl: options.fetchImpl,
	}

	await secureUpgrade(secureOptions)
}
