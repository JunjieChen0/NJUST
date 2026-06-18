/**
 * CLI-specific global slash commands
 *
 * These commands are handled entirely within the CLI and trigger actions
 * by sending messages to the extension host. They are separate from the
 * extension's built-in commands which expand into prompt content.
 */

/**
 * Action types that can be triggered by global commands.
 * Each action corresponds to a message type sent to the extension host.
 */
export type GlobalCommandAction =
	| "clearTask"
	| "openSettings"
	| "enhancePrompt"
	| "toggleWebSearch"
	| "openFileChanges"
	| "openHistory"
	| "editMessage"
	| "deleteMessage"
	| "toggleTheme"
	| "copyLastMessage"
	| "exportSession"
	| "compactSession"
	| "connectProvider"
	| "openModelPicker"
	| "openAgentPicker"
	| "openMcpManager"
	| "showHelp"
	| "showStatus"
	| "exitApp"

/**
 * Definition of a CLI global command
 */
export interface GlobalCommand {
	/** Command name (without the leading /) */
	name: string
	/** Description shown in the autocomplete picker */
	description: string
	/** Action to trigger when the command is executed */
	action: GlobalCommandAction
	/**
	 * Optional aliases that resolve to the same action (e.g. /new ↔ /clear,
	 * /sessions ↔ /resume ↔ /continue). Aliases are listed by the autocomplete
	 * picker so users can find them.
	 */
	aliases?: string[]
}

/**
 * CLI-specific global slash commands.
 *
 * Mirrors OpenCode's built-in slash command set
 * (see `opencode/packages/opencode/src/cli/cmd/tui/app.tsx` and
 * `routes/session/index.tsx`). Where OpenCode uses pluralized names like
 * `/models` / `/agents` / `/themes`, we follow the same convention so muscle
 * memory transfers cleanly between the two CLIs. Singular forms (`/model`,
 * `/agent`, `/theme`) are registered as aliases.
 */
export const GLOBAL_COMMANDS: GlobalCommand[] = [
	// Session lifecycle
	{
		name: "new",
		description: "Start a new task",
		action: "clearTask",
		aliases: ["clear"],
	},
	{
		name: "history",
		description: "Switch session — show full task history",
		action: "openHistory",
		aliases: ["sessions", "resume", "continue"],
	},
	{
		name: "compact",
		description: "Compact / summarize session context",
		action: "compactSession",
		aliases: ["summarize"],
	},
	{
		name: "export",
		description: "Export session transcript to markdown file",
		action: "exportSession",
	},
	{
		name: "copy",
		description: "Copy last assistant message to clipboard",
		action: "copyLastMessage",
	},

	// Provider / model / agent
	{
		name: "models",
		description: "Switch model",
		action: "openModelPicker",
		aliases: ["model"],
	},
	{
		name: "agents",
		description: "Switch agent / mode",
		action: "openAgentPicker",
		aliases: ["agent", "mode"],
	},
	{
		name: "connect",
		description: "Connect a provider — pick provider and enter API key",
		action: "connectProvider",
		aliases: ["provider", "providers"],
	},
	{
		name: "mcps",
		description: "Toggle MCP servers",
		action: "openMcpManager",
		aliases: ["mcp"],
	},

	// Settings & appearance
	{
		name: "settings",
		description: "Open settings panel",
		action: "openSettings",
	},
	{
		name: "themes",
		description: "Switch theme (toggle dark / light)",
		action: "toggleTheme",
		aliases: ["theme"],
	},

	// Editing & inspection
	{
		name: "edit",
		description: "Edit a previously sent message (e.g. /edit 2)",
		action: "editMessage",
	},
	{
		name: "delete",
		description: "Delete a previously sent message (e.g. /delete 2)",
		action: "deleteMessage",
	},
	{
		name: "changes",
		description: "Show file changes summary",
		action: "openFileChanges",
		aliases: ["diff"],
	},
	{
		name: "enhance",
		description: "Enhance the current prompt using AI",
		action: "enhancePrompt",
	},
	{
		name: "websearch",
		description: "Toggle web search on/off",
		action: "toggleWebSearch",
	},

	// Meta
	{
		name: "status",
		description: "View status (workspace, MCP, LSP, model, tokens)",
		action: "showStatus",
	},
	{
		name: "help",
		description: "Show keyboard shortcuts and slash command list",
		action: "showHelp",
	},
	{
		name: "exit",
		description: "Exit the app",
		action: "exitApp",
		aliases: ["quit", "q"],
	},
]

/**
 * Get a global command by name. Aliases (e.g. `/clear` for `/new`,
 * `/model` for `/models`) resolve to the same command record.
 */
export function getGlobalCommand(name: string): GlobalCommand | undefined {
	return GLOBAL_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases?.includes(name))
}

/**
 * Get global commands formatted for autocomplete.
 *
 * Each command is emitted once under its canonical name; aliases are
 * also emitted as separate entries (with the same action) so users can
 * find them by typing the alias. The description on alias entries
 * notes the canonical name.
 */
export function getGlobalCommandsForAutocomplete(): Array<{
	name: string
	description?: string
	source: "global" | "project" | "built-in"
	action?: string
}> {
	const out: Array<{
		name: string
		description?: string
		source: "global" | "project" | "built-in"
		action?: string
	}> = []
	for (const cmd of GLOBAL_COMMANDS) {
		out.push({
			name: cmd.name,
			description: cmd.description,
			source: "global",
			action: cmd.action,
		})
		for (const alias of cmd.aliases ?? []) {
			out.push({
				name: alias,
				description: `Alias for /${cmd.name}`,
				source: "global",
				action: cmd.action,
			})
		}
	}
	return out
}
