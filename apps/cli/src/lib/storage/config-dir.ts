import fs from "fs/promises"
import os from "os"
import path from "path"

import { NJUST_AI_CONFIG_DIR } from "@njust-ai/types"

const CONFIG_DIR = path.join(os.homedir(), NJUST_AI_CONFIG_DIR)

/** Platform-specific secure directory for sensitive material (master keys). */
function getPlatformSecureDir(): string {
	const home = os.homedir()
	switch (process.platform) {
		case "win32":
			return process.env.LOCALAPPDATA
				? path.join(process.env.LOCALAPPDATA, "NJUST-AI")
				: path.join(home, "AppData", "Local", "NJUST-AI")
		case "darwin":
			return path.join(home, "Library", "Application Support", "NJUST-AI")
		default:
			return path.join(home, ".local", "share", "NJUST-AI")
	}
}

export function getConfigDir(): string {
	return CONFIG_DIR
}

export function getSecureDir(): string {
	return getPlatformSecureDir()
}

export async function ensureConfigDir(): Promise<void> {
	try {
		await fs.mkdir(CONFIG_DIR, { recursive: true })
	} catch (err) {
		// Directory may already exist, that's fine.
		const error = err as NodeJS.ErrnoException

		if (error.code !== "EEXIST") {
			throw err
		}
	}
}

/**
 * Ensure the platform-specific secure directory exists, creating it with
 * restrictive 0o700 permissions (owner-only access) when missing.
 */
export async function ensureSecureDir(): Promise<void> {
	try {
		await fs.mkdir(getPlatformSecureDir(), { recursive: true, mode: 0o700 })
	} catch (err) {
		const error = err as NodeJS.ErrnoException

		if (error.code !== "EEXIST") {
			throw err
		}
	}
}
