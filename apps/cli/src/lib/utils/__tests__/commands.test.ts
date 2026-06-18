import {
	type GlobalCommand,
	type GlobalCommandAction,
	GLOBAL_COMMANDS,
	getGlobalCommand,
	getGlobalCommandsForAutocomplete,
} from "../commands.ts"

describe("globalCommands", () => {
	describe("GLOBAL_COMMANDS", () => {
		it("should contain the /new command", () => {
			const newCommand = GLOBAL_COMMANDS.find((cmd) => cmd.name === "new")
			expect(newCommand).toBeDefined()
			expect(newCommand?.action).toBe("clearTask")
			expect(newCommand?.description).toBe("Start a new task")
		})

		it("should contain the /settings command", () => {
			const settingsCommand = GLOBAL_COMMANDS.find((cmd) => cmd.name === "settings")
			expect(settingsCommand).toBeDefined()
			expect(settingsCommand?.action).toBe("openSettings")
			expect(settingsCommand?.description).toBe("Open settings panel")
		})

		it("should have valid structure for all commands", () => {
			for (const cmd of GLOBAL_COMMANDS) {
				expect(cmd.name).toBeTruthy()
				expect(typeof cmd.name).toBe("string")
				expect(cmd.description).toBeTruthy()
				expect(typeof cmd.description).toBe("string")
				expect(cmd.action).toBeTruthy()
				expect(typeof cmd.action).toBe("string")
			}
		})

		it("ships every OpenCode-aligned built-in slash command", () => {
			const required = [
				"new",
				"history",
				"compact",
				"export",
				"copy",
				"models",
				"agents",
				"connect",
				"mcps",
				"settings",
				"themes",
				"edit",
				"delete",
				"changes",
				"enhance",
				"websearch",
				"status",
				"help",
				"exit",
			]
			for (const name of required) {
				expect(GLOBAL_COMMANDS.some((c) => c.name === name)).toBe(true)
			}
		})
	})

	describe("getGlobalCommand", () => {
		it("should return the command when found", () => {
			const cmd = getGlobalCommand("new")
			expect(cmd).toBeDefined()
			expect(cmd?.name).toBe("new")
			expect(cmd?.action).toBe("clearTask")
		})

		it("should return undefined for unknown commands", () => {
			const cmd = getGlobalCommand("unknown-command")
			expect(cmd).toBeUndefined()
		})

		it("should be case-sensitive", () => {
			const cmd = getGlobalCommand("NEW")
			expect(cmd).toBeUndefined()
		})

		it("resolves /clear as alias of /new", () => {
			const cmd = getGlobalCommand("clear")
			expect(cmd?.name).toBe("new")
			expect(cmd?.action).toBe("clearTask")
		})

		it("resolves /model (singular) as alias of /models", () => {
			const cmd = getGlobalCommand("model")
			expect(cmd?.name).toBe("models")
			expect(cmd?.action).toBe("openModelPicker")
		})

		it("resolves /q as alias of /exit", () => {
			const cmd = getGlobalCommand("q")
			expect(cmd?.name).toBe("exit")
			expect(cmd?.action).toBe("exitApp")
		})
	})

	describe("getGlobalCommandsForAutocomplete", () => {
		it("should return commands in autocomplete format", () => {
			const commands = getGlobalCommandsForAutocomplete()
			// One entry per canonical command + one per alias.
			const aliasCount = GLOBAL_COMMANDS.reduce((n, c) => n + (c.aliases?.length ?? 0), 0)
			expect(commands.length).toBe(GLOBAL_COMMANDS.length + aliasCount)

			for (const cmd of commands) {
				expect(cmd.name).toBeTruthy()
				expect(cmd.source).toBe("global")
				expect(cmd.action).toBeTruthy()
			}
		})

		it("should include the /new command with correct format", () => {
			const commands = getGlobalCommandsForAutocomplete()
			const newCommand = commands.find((cmd) => cmd.name === "new")

			expect(newCommand).toBeDefined()
			expect(newCommand?.description).toBe("Start a new task")
			expect(newCommand?.source).toBe("global")
			expect(newCommand?.action).toBe("clearTask")
		})

		it("should not include argumentHint for action commands", () => {
			const commands = getGlobalCommandsForAutocomplete()
			// Action commands don't have argument hints
			for (const cmd of commands) {
				expect(cmd).not.toHaveProperty("argumentHint")
			}
		})

		it("emits aliases as separate entries pointing to the same action", () => {
			const commands = getGlobalCommandsForAutocomplete()
			const clear = commands.find((c) => c.name === "clear")
			expect(clear?.action).toBe("clearTask")
			expect(clear?.description).toContain("Alias for /new")
		})
	})

	describe("type safety", () => {
		it("should have valid GlobalCommandAction types", () => {
			// This test ensures the type is properly constrained
			const validActions: GlobalCommandAction[] = [
				"clearTask",
				"openSettings",
				"enhancePrompt",
				"toggleWebSearch",
				"openFileChanges",
				"openHistory",
				"editMessage",
				"deleteMessage",
				"toggleTheme",
				"copyLastMessage",
				"exportSession",
				"compactSession",
				"connectProvider",
				"openModelPicker",
				"openAgentPicker",
				"openMcpManager",
				"showHelp",
				"showStatus",
				"exitApp",
			]

			for (const cmd of GLOBAL_COMMANDS) {
				expect(validActions).toContain(cmd.action)
			}
		})

		it("should match GlobalCommand interface", () => {
			const testCommand: GlobalCommand = {
				name: "test",
				description: "Test command",
				action: "clearTask",
			}

			expect(testCommand.name).toBe("test")
			expect(testCommand.description).toBe("Test command")
			expect(testCommand.action).toBe("clearTask")
		})
	})
})
