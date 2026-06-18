/**
 * Command Registry - OpenCode-aligned
 *
 * Unified command surface that backs:
 *   - Command palette (Ctrl+K / Ctrl+P)
 *   - Slash commands (typed `/name` in the prompt)
 *   - Keybindings
 *
 * Commands can be registered globally (this module) or per-session by
 * pushing entries into the registry. The default list includes:
 *
 *   session.new          → start a new task
 *   session.interrupt    → abort the in-flight task
 *   theme.toggle         → switch light/dark
 *   mode.cycle           → rotate through modes
 *   app.exit             → quit the TUI
 *   help.show            → open the keymap help dialog
 *
 * Slash-form (`/help`, `/clear`, `/exit`) is just an alias resolution:
 * the prompt strips the leading `/` and calls `runCommandBySlashName`.
 */

import { createContext, useContext, ParentProps } from "solid-js"

export interface Command {
	id: string
	label: string
	description?: string
	/** Slash form: `help`, `clear`, `exit`. Optional. */
	slashName?: string
	/** Optional keybinding display, e.g. "Ctrl+K". */
	keybinding?: string
	/** Category used to group items in the palette. Defaults to id prefix. */
	category?: string
	/** Run the command. May be async. */
	run: () => void | Promise<void>
	/** If false, the command is hidden from the palette (still runnable). */
	hidden?: boolean
}

class CommandRegistry {
	private commands = new Map<string, Command>()

	register(command: Command): void {
		this.commands.set(command.id, command)
	}

	unregister(id: string): void {
		this.commands.delete(id)
	}

	get(id: string): Command | undefined {
		return this.commands.get(id)
	}

	list(): Command[] {
		return Array.from(this.commands.values())
	}

	listVisible(): Command[] {
		return this.list().filter((c) => !c.hidden)
	}

	listByCategory(category: string): Command[] {
		return this.list().filter((cmd) => (cmd.category ?? cmd.id.split(".")[0]) === category)
	}

	/** Resolve a slash name (e.g. "help") to a registered command. */
	resolveSlashName(slashName: string): Command | undefined {
		return this.list().find((c) => c.slashName === slashName)
	}

	async runById(id: string): Promise<boolean> {
		const cmd = this.get(id)
		if (!cmd) return false
		await cmd.run()
		return true
	}

	async runBySlashName(slashName: string): Promise<boolean> {
		const cmd = this.resolveSlashName(slashName)
		if (!cmd) return false
		await cmd.run()
		return true
	}
}

export const commandRegistry = new CommandRegistry()

// =============================================================================
// Default commands
// =============================================================================

commandRegistry.register({
	id: "session.new",
	label: "New Session",
	description: "Start a new session",
	slashName: "new",
	category: "Session",
	run: () => {
		/* wired by parent at startup */
	},
})

commandRegistry.register({
	id: "session.interrupt",
	label: "Interrupt",
	description: "Abort the in-flight task (Esc Esc)",
	category: "Session",
	hidden: true,
	run: () => {},
})

commandRegistry.register({
	id: "session.resume",
	label: "Resume Session",
	description: "Resume a recent session",
	category: "Session",
	run: () => {},
})

commandRegistry.register({
	id: "app.exit",
	label: "Exit",
	description: "Exit the application",
	slashName: "exit",
	category: "App",
	run: () => {
		process.exit(0)
	},
})

commandRegistry.register({
	id: "command.palette.show",
	label: "Command Palette",
	description: "Open the command palette",
	keybinding: "Ctrl+K",
	category: "App",
	run: () => {},
})

commandRegistry.register({
	id: "agent.showPicker",
	label: "Select Agent",
	description: "Open the agent/mode picker",
	keybinding: "Tab",
	category: "Agent",
	run: () => {},
})

commandRegistry.register({
	id: "mode.cycle",
	label: "Cycle Mode",
	description: "Cycle through modes (code, architect, ask, debug)",
	keybinding: "Ctrl+M",
	category: "App",
	run: () => {},
})

commandRegistry.register({
	id: "help.show",
	label: "Show Help",
	description: "Open the keybinding help",
	slashName: "help",
	keybinding: "?",
	category: "Help",
	run: () => {},
})

commandRegistry.register({
	id: "prompt.clear",
	label: "Clear Prompt",
	description: "Clear the prompt input",
	slashName: "clear",
	category: "Prompt",
	hidden: true,
	run: () => {},
})

commandRegistry.register({
	id: "agent.showPicker",
	label: "Select Agent",
	description: "Open the agent/mode picker",
	keybinding: "Tab",
	category: "Agent",
	run: () => {},
})

// =============================================================================
// Solid context (optional - keeps registry reference stable for hooks)
// =============================================================================

const CommandContext = createContext<CommandRegistry>()

export function CommandProvider(props: ParentProps) {
	return <CommandContext.Provider value={commandRegistry}>{props.children}</CommandContext.Provider>
}

export function useCommandRegistry(): CommandRegistry {
	return useContext(CommandContext) ?? commandRegistry
}
