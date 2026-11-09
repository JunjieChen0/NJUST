import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const { profileStorage, setProfileStorageService } = vi.hoisted(() => ({
	profileStorage: {
		initialize: vi.fn().mockResolvedValue(undefined),
		migrateFromLegacyConfig: vi.fn().mockResolvedValue(null),
	},
	setProfileStorageService: vi.fn(),
}))

vi.mock("../../services/cloud-agent/ProfileStorageService", () => ({
	ProfileStorageService: vi.fn(function () {
		return profileStorage
	}),
	setProfileStorageService,
}))

vi.mock("../../i18n", () => ({ t: (key: string) => key }))

vi.mock("vscode", () => ({
	workspace: { getConfiguration: vi.fn() },
	window: { showInformationMessage: vi.fn() },
	ConfigurationTarget: { Global: 1 },
}))

import { initializeCloudAgent } from "../cloudAgentInit"

function createContext(secretToken?: string) {
	const secrets = new Map<string, string>()
	if (secretToken) secrets.set("njust-ai.cloudAgent.deviceToken", secretToken)
	return {
		secrets: {
			get: vi.fn(async (key: string) => secrets.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				secrets.set(key, value)
			}),
		},
		globalState: { get: vi.fn().mockReturnValue(undefined), update: vi.fn().mockResolvedValue(undefined) },
		workspaceState: { get: vi.fn(), update: vi.fn() },
	} as any
}

function createConfig(legacyToken = "") {
	return {
		get: vi.fn((key: string, defaultValue?: unknown) =>
			key === "cloudAgent.deviceToken" ? legacyToken : defaultValue,
		),
		update: vi.fn().mockResolvedValue(undefined),
	}
}

describe("initializeCloudAgent device-token migration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		profileStorage.initialize.mockResolvedValue(undefined)
		profileStorage.migrateFromLegacyConfig.mockResolvedValue(null)
	})

	it("moves a legacy settings token to SecretStorage and clears the plaintext setting", async () => {
		const context = createContext()
		const config = createConfig("legacy-device-token")
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)
		const outputChannel = { appendLine: vi.fn() } as any

		await initializeCloudAgent(context, outputChannel)

		expect(context.secrets.store).toHaveBeenCalledWith("njust-ai.cloudAgent.deviceToken", "legacy-device-token")
		expect(config.update).toHaveBeenCalledWith(
			"cloudAgent.deviceToken",
			undefined,
			vscode.ConfigurationTarget.Global,
		)
	})

	it("clears a stale plaintext setting even when SecretStorage already has the token", async () => {
		const context = createContext("stored-device-token")
		const config = createConfig("stale-legacy-token")
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

		await initializeCloudAgent(context, { appendLine: vi.fn() } as any)

		expect(context.secrets.store).not.toHaveBeenCalled()
		expect(config.update).toHaveBeenCalledWith(
			"cloudAgent.deviceToken",
			undefined,
			vscode.ConfigurationTarget.Global,
		)
	})
})
