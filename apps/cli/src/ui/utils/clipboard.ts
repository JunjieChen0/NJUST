/**
 * Cross-platform clipboard utility.
 *
 * On Windows uses PowerShell's Set-Clipboard.
 * On macOS uses pbcopy.
 * On Linux uses wl-copy/xclip/xsel.
 * Fallback: OSC 52 escape sequence (works over SSH/tmux).
 */

export async function copyToClipboard(text: string): Promise<boolean> {
	// Try platform-native clipboard first
	const platform = process.platform

	try {
		if (platform === "win32") {
			const { execFileSync } = await import("child_process")
			execFileSync("powershell.exe", ["-NoProfile", "-Command", "$input | Set-Clipboard"], {
				input: text,
				encoding: "utf-8",
				timeout: 5000,
			})
			return true
		}

		if (platform === "darwin") {
			const { execFileSync } = await import("child_process")
			execFileSync("pbcopy", { input: text, encoding: "utf-8", timeout: 5000 })
			return true
		}

		if (platform === "linux") {
			const { execFileSync } = await import("child_process")
			// Try wl-copy (Wayland) first, then xclip, then xsel
			for (const cmd of ["wl-copy", "xclip", "-selection", "clipboard", "xsel", "--clipboard", "--input"]) {
				try {
					if (cmd === "xclip") {
						execFileSync("xclip", ["-selection", "clipboard"], {
							input: text,
							encoding: "utf-8",
							timeout: 5000,
						})
					} else if (cmd === "xsel") {
						execFileSync("xsel", ["--clipboard", "--input"], {
							input: text,
							encoding: "utf-8",
							timeout: 5000,
						})
					} else {
						execFileSync(cmd, { input: text, encoding: "utf-8", timeout: 5000 })
					}
					return true
				} catch {
					// Try next command
				}
			}
		}
	} catch {
		// Fall through to OSC 52
	}

	// Fallback: OSC 52 escape sequence (works over SSH/tmux)
	try {
		process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`)
		return true
	} catch {
		return false
	}
}
