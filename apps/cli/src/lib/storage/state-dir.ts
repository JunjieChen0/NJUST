import fs from "fs/promises"
import os from "os"
import path from "path"

import { NJUST_AI_CONFIG_DIR } from "@njust-ai/types"

/**
 * Platform-specific XDG-style state directory for ephemeral, restorable
 * application state — distinct from `getConfigDir()` (user-edited config)
 * and `getSecureDir()` (secrets).
 *
 * Mirrors OpenCode's `Global.Path.state` (xdgState!/opencode) with
 * platform parity:
 *   Linux:   $XDG_STATE_HOME/njust-ai      (default: ~/.local/state/njust-ai)
 *   macOS:   ~/Library/Application Support/NJUST-AI/state
 *   Windows: %LOCALAPPDATA%\NJUST-AI\state
 *
 * Used for files like `model.json` (recent/favorite/variant model
 * selections) that the user shouldn't edit by hand but the app should
 * restore across launches.
 */
function getPlatformStateDir(): string {
	const home = os.homedir()
	switch (process.platform) {
		case "win32":
			return process.env.LOCALAPPDATA
				? path.join(process.env.LOCALAPPDATA, "NJUST-AI", "state")
				: path.join(home, "AppData", "Local", "NJUST-AI", "state")
		case "darwin":
			return path.join(home, "Library", "Application Support", "NJUST-AI", "state")
		default: {
			const xdg = process.env.XDG_STATE_HOME
			const base = xdg && xdg.length > 0 ? xdg : path.join(home, ".local", "state")
			return path.join(base, NJUST_AI_CONFIG_DIR.replace(/^\./, ""))
		}
	}
}

export function getStateDir(): string {
	return getPlatformStateDir()
}

export async function ensureStateDir(): Promise<void> {
	try {
		await fs.mkdir(getPlatformStateDir(), { recursive: true })
	} catch (err) {
		const error = err as NodeJS.ErrnoException
		if (error.code !== "EEXIST") throw err
	}
}
