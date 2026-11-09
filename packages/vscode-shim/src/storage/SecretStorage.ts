import * as crypto from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { execFileSync } from "child_process"
import { EventEmitter } from "../classes/EventEmitter.js"
import { ensureDirectoryExists } from "../utils/paths.js"
import type { SecretStorage, SecretStorageChangeEvent } from "../types.js"

const ENCRYPTION_ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

/** File name for the random master key (kept beside secrets.json). */
const KEY_FILE_NAME = "secrets.key"

/**
 * File-based implementation of VSCode's SecretStorage interface
 *
 * Stores secrets in an encrypted file on disk using AES-256-GCM encryption.
 * The encryption key is a randomly-generated master key persisted in a
 * sidecar file (`secrets.key`) with restrictive permissions.
 *
 * On first launch after upgrading from the legacy machine-ID-derived key,
 * existing secrets are transparently re-encrypted with the new random key.
 *
 * **Security Notes:**
 * - Secrets are encrypted at rest using AES-256-GCM
 * - Master key is cryptographically random (32 bytes)
 * - File permissions are set restrictive (0600) on Unix-like systems
 * - On Windows, inheritance is disabled and only the current user retains access
 * - This shim is used by the CLI host (`@njust-ai/vscode-shim`); the real VS Code
 *   extension uses VS Code's native SecretStorage (OS keychain). The master key
 *   therefore sits beside the ciphertext in this shim only. If the CLI ever needs
 *   keychain-grade protection, inject a platform SecretStorage implementation at
 *   the ExtensionContext boundary rather than changing this file format in place.
 * - Corrupt ciphertext or an invalid key file is preserved as a `.corrupt-*` backup
 *   and the store starts empty, so a bad file cannot abort host startup.
 *
 * @example
 * ```typescript
 * const storage = new FileSecretStorage('/path/to/storage')
 *
 * // Store a secret
 * await storage.store('apiKey', 'sk-...')
 *
 * // Retrieve a secret
 * const key = await storage.get('apiKey')
 *
 * // Listen for changes
 * storage.onDidChange((e) => {
 *   console.log(`Secret ${e.key} changed`)
 * })
 * ```
 */
export class FileSecretStorage implements SecretStorage {
	private secrets: Record<string, string> = {}
	private _onDidChange = new EventEmitter<SecretStorageChangeEvent>()
	private filePath: string
	private encryptionKey: Buffer | null = null

	/**
	 * Create a new FileSecretStorage
	 *
	 * @param storagePath - Directory path where secrets.json will be stored
	 */
	constructor(storagePath: string) {
		this.filePath = path.join(storagePath, "secrets.json")
		this.loadFromFile()
	}

	/**
	 * Load secrets from the encrypted JSON file.
	 * Handles transparent migration from the legacy machine-ID-derived key.
	 *
	 * A ciphertext that cannot be decrypted with either key is treated as corrupt:
	 * the original file is preserved as a `.corrupt-<timestamp>` backup and the
	 * store starts empty instead of throwing. Throwing here aborts construction of
	 * ExtensionContext (and therefore the whole CLI host), leaving no way to
	 * recover short of deleting files by hand.
	 */
	private loadFromFile(): void {
		if (!fs.existsSync(this.filePath)) return

		const keyFile = this.getKeyFilePath()
		let encryptedContent: string
		try {
			encryptedContent = fs.readFileSync(this.filePath, "utf-8")
		} catch (error) {
			// Unreadable file: recover the same way as undecryptable data.
			this.secrets = {}
			console.warn(`Could not read secrets from ${this.filePath}; starting with an empty store.`, error)
			return
		}
		let migratedFromLegacy = false

		try {
			if (fs.existsSync(keyFile)) {
				try {
					this.secrets = JSON.parse(this.decrypt(encryptedContent))
					return
				} catch {
					// A prior migration may have saved its key before publishing the new ciphertext.
					console.warn(`Checking for an interrupted legacy migration at ${this.filePath}`)
				}
			}
			this.secrets = JSON.parse(this.decryptWithKey(encryptedContent, this.deriveLegacyKey()))
			migratedFromLegacy = true
		} catch (error) {
			// Only unreadable *data* is recoverable here. Write/IO failures during
			// migration must still propagate: swallowing them would break the atomic
			// publish guarantee and lose the original ciphertext.
			this.secrets = {}
			this.preserveCorruptFile()
			console.warn(
				`Failed to load secrets from ${this.filePath}; starting with an empty store. ` +
					`The original file was kept as a backup.`,
				error,
			)
			return
		}

		// Re-encrypt legacy data with a random key. This performs a write, so it is
		// deliberately outside the recovery try/catch above.
		if (migratedFromLegacy) {
			if (!fs.existsSync(keyFile)) this.persistNewRandomKey()
			this.saveToFile(this.secrets)
		}
	}

	/** Rename an undecryptable secrets file aside so it is never silently lost. */
	private preserveCorruptFile(): void {
		try {
			const backup = `${this.filePath}.corrupt-${Date.now()}`
			fs.renameSync(this.filePath, backup)
			console.warn(`Preserved unreadable secrets file at ${backup}`)
		} catch (backupError) {
			console.warn(`Could not preserve unreadable secrets file ${this.filePath}:`, backupError)
		}
	}

	/**
	 * Save secrets to the encrypted JSON file with restrictive permissions
	 */
	private saveToFile(secrets: Record<string, string>): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			ensureDirectoryExists(dir)

			// Encrypt the secrets before writing
			const plaintext = JSON.stringify(secrets, null, 2)
			const encryptedContent = this.encrypt(plaintext)
			this.writeProtectedFile(this.filePath, encryptedContent)
		} catch (error) {
			console.warn(`Failed to save secrets to ${this.filePath}:`, error)
			throw error
		}
	}

	/**
	 * Retrieve a secret by key
	 *
	 * @param key - The secret key
	 * @returns The secret value or undefined if not found
	 */
	async get(key: string): Promise<string | undefined> {
		return this.secrets[key]
	}

	/**
	 * Store a secret
	 *
	 * @param key - The secret key
	 * @param value - The secret value
	 */
	async store(key: string, value: string): Promise<void> {
		const next = { ...this.secrets, [key]: value }
		this.saveToFile(next)
		this.secrets = next
		this._onDidChange.fire({ key })
	}

	/**
	 * Delete a secret
	 *
	 * @param key - The secret key to delete
	 */
	async delete(key: string): Promise<void> {
		const next = { ...this.secrets }
		delete next[key]
		this.saveToFile(next)
		this.secrets = next
		this._onDidChange.fire({ key })
	}

	/**
	 * Event fired when a secret changes
	 */
	get onDidChange() {
		return this._onDidChange.event
	}

	/**
	 * Clear all secrets (useful for testing)
	 */
	clearAll(): void {
		this.saveToFile({})
		this.secrets = {}
	}

	/**
	 * Derive the legacy machine-ID-based encryption key (for migration only).
	 * Uses hostname and username to create a unique identifier per machine/user,
	 * then derives a key via scrypt.
	 */
	private deriveLegacyKey(): Buffer {
		let machineId: string
		try {
			const hostname = os.hostname() || "unknown-host"
			const username = os.userInfo().username || "unknown-user"
			const platform = process.platform || "unknown-platform"
			machineId = `${username}@${hostname}:${platform}`
		} catch {
			machineId = `unknown@${os.hostname() || "unknown-host"}:${process.platform || "unknown"}`
		}
		return crypto.scryptSync(machineId, "njust-ai-secret-storage-v1", KEY_LENGTH)
	}

	/**
	 * Return the path to the random master key file (kept beside secrets.json).
	 */
	private getKeyFilePath(): string {
		return path.join(path.dirname(this.filePath), KEY_FILE_NAME)
	}

	/**
	 * Generate a new random key, persist it to disk with restrictive
	 * permissions, and cache it as the active encryption key.
	 */
	private persistNewRandomKey(): void {
		const keyFile = this.getKeyFilePath()
		const key = crypto.randomBytes(KEY_LENGTH)
		this.writeProtectedFile(keyFile, key)
		this.encryptionKey = key
	}

	/** Publish only after the complete file has owner-only permissions. */
	private writeProtectedFile(file: string, content: string | Buffer): void {
		const temporary = `${file}.${crypto.randomUUID()}.tmp`
		// Secure the empty file before any key bytes are written, including if icacls fails.
		fs.writeFileSync(temporary, "", { mode: 0o600, flag: "wx" })
		if (process.platform === "win32") {
			execFileSync("icacls", [temporary, "/inheritance:r", "/grant:r", `${os.userInfo().username}:(F)`], {
				timeout: 5000,
				windowsHide: true,
			})
		}
		fs.writeFileSync(temporary, content, { flag: "r+" })
		fs.renameSync(temporary, file)
	}

	/**
	 * Derive or load the encryption key.
	 *
	 * Prefer a randomly-generated master key persisted in a sidecar file
	 * (`secrets.key`) with 0600 permissions.  This avoids the weakness of
	 * deriving the key solely from predictable machine identifiers
	 * (hostname + username) which any local user can guess.
	 *
	 * Legacy key migration is handled in loadFromFile(); by the time this
	 * method is called during normal operation, the random key already exists.
	 */
	private getEncryptionKey(): Buffer {
		if (!this.encryptionKey) {
			const keyFile = this.getKeyFilePath()
			if (fs.existsSync(keyFile)) {
				const key = fs.readFileSync(keyFile)
				if (key.length === KEY_LENGTH) {
					this.encryptionKey = key
				} else {
					// A truncated/tampered key file must not brick every future write.
					// Preserve it and rotate to a fresh random key.
					this.preserveCorruptKeyFile()
					this.persistNewRandomKey()
				}
			} else {
				// Fresh install — no secrets.json and no key file
				this.persistNewRandomKey()
			}
		}
		return this.encryptionKey!
	}

	private preserveCorruptKeyFile(): void {
		const keyFile = this.getKeyFilePath()
		try {
			const backup = `${keyFile}.corrupt-${Date.now()}`
			fs.renameSync(keyFile, backup)
			console.warn(`Preserved invalid master key file at ${backup}`)
		} catch (backupError) {
			console.warn(`Could not preserve invalid master key file ${keyFile}:`, backupError)
		}
	}

	/**
	 * Encrypt plaintext using AES-256-GCM.
	 * Returns a base64-encoded string containing IV, auth tag, and ciphertext.
	 */
	private encrypt(plaintext: string): string {
		const key = this.getEncryptionKey()
		return this.encryptWithKey(plaintext, key)
	}

	/**
	 * Decrypt ciphertext that was encrypted with encrypt().
	 * Returns the original plaintext string.
	 * Throws if decryption fails (e.g., tampered data, wrong key).
	 */
	private decrypt(ciphertext: string): string {
		const key = this.getEncryptionKey()
		return this.decryptWithKey(ciphertext, key)
	}

	/** Encrypt with an explicit key buffer. */
	private encryptWithKey(plaintext: string, key: Buffer): string {
		const iv = crypto.randomBytes(IV_LENGTH)
		const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
		const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
		const authTag = cipher.getAuthTag()
		return Buffer.concat([iv, authTag, encrypted]).toString("base64")
	}

	/** Decrypt with an explicit key buffer. */
	private decryptWithKey(ciphertext: string, key: Buffer): string {
		try {
			const data = Buffer.from(ciphertext, "base64")
			const iv = data.subarray(0, IV_LENGTH)
			const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
			const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
			const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
			decipher.setAuthTag(authTag)
			return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
		} catch {
			throw new Error("Failed to decrypt secrets - data may be corrupted or tampered")
		}
	}
}
