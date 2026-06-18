import fs from "fs"
import path from "path"
import os from "os"

export interface TuiKeybinding {
	key: string
	ctrl?: boolean
	shift?: boolean
	alt?: boolean
	meta?: boolean
	command: string
}

export interface TuiConfig {
	leader?: string
	keybindings?: TuiKeybinding[]
	theme?: "light" | "dark" | "system"
	compact?: boolean
	showReasoning?: boolean
	mouse?: boolean
	diffStyle?: "unified" | "split"
}

const CONFIG_DIR = path.join(os.homedir(), ".njust-ai")
const CONFIG_PATH = path.join(CONFIG_DIR, "tui.json")

export const defaultKeybindings: TuiKeybinding[] = [
	{ key: "k", ctrl: true, command: "command.palette.show" },
	{ key: "p", ctrl: true, command: "command.palette.show" },
	{ key: "Tab", command: "agent.showPicker" },
	{ key: "m", ctrl: true, command: "mode.cycle" },
	{ key: "t", ctrl: true, command: "model.showPicker" },
	{ key: "l", ctrl: true, command: "theme.toggle" },
	{ key: "n", ctrl: true, command: "session.new" },
	{ key: "r", ctrl: true, command: "session.resume" },
	{ key: "c", ctrl: true, command: "session.interrupt" },
]

export function loadTuiConfig(): TuiConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
			const parsed = JSON.parse(raw) as TuiConfig
			return {
				leader: parsed.leader ?? "ctrl+x",
				keybindings: parsed.keybindings ?? defaultKeybindings,
				theme: parsed.theme ?? "system",
				compact: parsed.compact ?? false,
				showReasoning: parsed.showReasoning ?? true,
				mouse: parsed.mouse ?? true,
				diffStyle: parsed.diffStyle ?? "unified",
			}
		}
	} catch {
		// ignore config errors
	}
	return {
		leader: "ctrl+x",
		keybindings: defaultKeybindings,
		theme: "system",
		compact: false,
		showReasoning: true,
		mouse: true,
		diffStyle: "unified",
	}
}

export function saveTuiConfig(config: TuiConfig): void {
	try {
		if (!fs.existsSync(CONFIG_DIR)) {
			fs.mkdirSync(CONFIG_DIR, { recursive: true })
		}
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
	} catch {
		// ignore save errors
	}
}

export function normalizeKeyName(input: string): string {
	return input.toLowerCase().replace(/\s+/g, "")
}

export function matchesKeybinding(
	binding: TuiKeybinding,
	key: string,
	modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
): boolean {
	const normalizedBindingKey = normalizeKeyName(binding.key)
	const normalizedKey = normalizeKeyName(key)
	if (normalizedBindingKey !== normalizedKey) return false
	if (!!binding.ctrl !== !!modifiers.ctrl) return false
	if (!!binding.shift !== !!modifiers.shift) return false
	if (!!binding.alt !== !!modifiers.alt) return false
	if (!!binding.meta !== !!modifiers.meta) return false
	return true
}
