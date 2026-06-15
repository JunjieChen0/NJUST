import * as crypto from "crypto"
import * as os from "os"
import fs from "fs/promises"
import path from "path"

import { getConfigDir, getSecureDir, ensureSecureDir } from "./index.js"

const CREDENTIALS_FILE = path.join(getConfigDir(), "cli-credentials.json")
const CREDENTIALS_ENC_FILE = path.join(getConfigDir(), "cli-credentials.enc")

// Encryption constants
const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

// Version prefix for encrypted data format.
// v1: random master key (current)
// (no prefix): legacy key derivation from machine-id
const VERSION_PREFIX = "v1:"

export interface Credentials {
	token: string
	createdAt: string
	userId?: string
	orgId?: string
}

/**
 * Generate a new random 256-bit master key using a CSPRNG.
 */
function generateMasterKey(): Buffer {
	return crypto.randomBytes(KEY_LENGTH)
}

/**
 * Load the master key from disk, or generate and persist a new one.
 */
async function getOrCreateMasterKey(): Promise<Buffer> {
	const masterKeyFile = path.join(getSecureDir(), ".masterkey")
	try {
		const data = await fs.readFile(masterKeyFile)
		if (data.length !== KEY_LENGTH) {
			const key = generateMasterKey()
			await fs.writeFile(masterKeyFile, key, { mode: 0o600 })
			return key
		}
		return Buffer.from(data)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
		const key = generateMasterKey()
		await ensureSecureDir()
		await fs.writeFile(masterKeyFile, key, { mode: 0o600 })
		return key
	}
}

// ── Legacy key derivation (for migration only) ────────────────────

const LEGACY_SALT = "njust-ai-cli-credentials-v1"

function getLegacyMachineId(): string {
	try {
		const hostname = os.hostname() || "unknown-host"
		const username = os.userInfo().username || "unknown-user"
		const platform = process.platform || "unknown-platform"
		return `${username}@${hostname}:${platform}`
	} catch {
		return `unknown@${os.hostname() || "unknown-host"}:${process.platform || "unknown"}`
	}
}

function deriveLegacyKey(): Buffer {
	return crypto.scryptSync(getLegacyMachineId(), LEGACY_SALT, KEY_LENGTH)
}

// ── Public API ────────────────────────────────────────────────────

export async function saveToken(token: string, options?: { userId?: string; orgId?: string }): Promise<void> {
	await fs.mkdir(getConfigDir(), { recursive: true })

	const credentials: Credentials = {
		token,
		createdAt: new Date().toISOString(),
		userId: options?.userId,
		orgId: options?.orgId,
	}

	const plaintext = JSON.stringify(credentials, null, 2)
	const masterKey = await getOrCreateMasterKey()
	const encrypted = VERSION_PREFIX + encrypt(plaintext, masterKey)

	await fs.writeFile(CREDENTIALS_ENC_FILE, encrypted, { mode: 0o600 })

	// Clean up legacy plaintext file if it exists
	await unlinkIfExists(CREDENTIALS_FILE)
}

export async function loadToken(): Promise<string | null> {
	const credentials = await loadCredentials()
	return credentials?.token ?? null
}

export async function loadCredentials(): Promise<Credentials | null> {
	// 1. Try encrypted file with new key first, fall back to legacy key.
	try {
		const raw = await fs.readFile(CREDENTIALS_ENC_FILE, "utf-8")
		let data = raw
		let masterKey: Buffer

		if (raw.startsWith(VERSION_PREFIX)) {
			// v1 format: decrypt with random master key.
			data = raw.slice(VERSION_PREFIX.length)
			masterKey = await getOrCreateMasterKey()
		} else {
			// Legacy format (no prefix): try new key first, then legacy key.
			try {
				masterKey = await getOrCreateMasterKey()
				const plaintext = decrypt(data, masterKey)
				const credentials = JSON.parse(plaintext) as Credentials
				// Success with new key — migrate to v1 format.
				await saveToken(credentials.token, { userId: credentials.userId, orgId: credentials.orgId })
				return credentials
			} catch {
				// New key failed — try legacy derivation.
				masterKey = deriveLegacyKey()
			}
		}

		const plaintext = decrypt(data, masterKey)
		const credentials = JSON.parse(plaintext) as Credentials

		// If we used legacy key, migrate to v1 format now.
		if (!raw.startsWith(VERSION_PREFIX)) {
			console.log("Migrating CLI credentials from legacy encryption to new random-key format")
			await saveToken(credentials.token, { userId: credentials.userId, orgId: credentials.orgId })
		}

		return credentials
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== "ENOENT") {
			console.warn("Failed to decrypt CLI credentials, discarding corrupted file")
			return null
		}
	}

	// 2. Fall back to legacy plaintext file and auto-migrate
	try {
		const data = await fs.readFile(CREDENTIALS_FILE, "utf-8")
		const credentials = JSON.parse(data) as Credentials

		await migrateToEncrypted(credentials)
		console.log("Migrated CLI credentials from plaintext to encrypted storage")
		return credentials
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null
		}
		throw error
	}
}

export async function clearToken(): Promise<void> {
	await unlinkIfExists(CREDENTIALS_ENC_FILE)
	await unlinkIfExists(CREDENTIALS_FILE)
}

export async function hasToken(): Promise<boolean> {
	const token = await loadToken()
	return token !== null
}

export function getCredentialsPath(): string {
	return CREDENTIALS_ENC_FILE
}

export function getLegacyCredentialsPath(): string {
	return CREDENTIALS_FILE
}

// ── Encryption helpers ─────────────────────────────────────────────

async function migrateToEncrypted(credentials: Credentials): Promise<void> {
	await fs.mkdir(getConfigDir(), { recursive: true })

	const plaintext = JSON.stringify(credentials, null, 2)
	const masterKey = await getOrCreateMasterKey()
	const encrypted = VERSION_PREFIX + encrypt(plaintext, masterKey)
	await fs.writeFile(CREDENTIALS_ENC_FILE, encrypted, { mode: 0o600 })

	await unlinkIfExists(CREDENTIALS_FILE)
}

async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await fs.unlink(filePath)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
}

function encrypt(plaintext: string, key: Buffer): string {
	const iv = crypto.randomBytes(IV_LENGTH)
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const authTag = cipher.getAuthTag()
	return Buffer.concat([iv, authTag, encrypted]).toString("base64")
}

function decrypt(ciphertext: string, key: Buffer): string {
	const data = Buffer.from(ciphertext, "base64")
	const iv = data.subarray(0, IV_LENGTH)
	const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
	const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(authTag)
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
