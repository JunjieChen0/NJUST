import * as vscode from "vscode"
import { setDeviceToken } from "../services/cloud-agent/deviceToken"
import { getErrorMessage } from "../shared/error-utils"
import { t } from "../i18n"

/**
 * Initialize Cloud Agent device token (SecretStorage with legacy migration)
 * and ProfileStorageService (with legacy config migration).
 */
export async function initializeCloudAgent(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const DEVICE_TOKEN_KEY = "njust-ai.cloudAgent.deviceToken"
	const config = vscode.workspace.getConfiguration("njust-ai")
	let deviceToken = await context.secrets.get(DEVICE_TOKEN_KEY)
	if (!deviceToken) {
		// Migration: check old globalState key then old config value
		const legacyToken =
			context.globalState.get<string>("njustCloudDeviceToken") || config.get<string>("cloudAgent.deviceToken", "")
		if (legacyToken?.trim()) {
			deviceToken = legacyToken.trim()
		} else {
			const { randomUUID } = await import("crypto")
			deviceToken = randomUUID()
		}
		await context.secrets.store(DEVICE_TOKEN_KEY, deviceToken)
		// Clean up legacy storage
		await context.globalState.update("njustCloudDeviceToken", undefined)
		outputChannel.appendLine("[CloudAgent] Device token generated and saved to SecretStorage.")
	}
	setDeviceToken(deviceToken)

	// The plaintext setting is read only as a legacy migration source. Remove
	// it on every startup (not just when the secret was first created) so an
	// old token cannot survive in settings.json or Settings Sync after the
	// SecretStorage value has become the source of truth.
	try {
		await config.update("cloudAgent.deviceToken", undefined, vscode.ConfigurationTarget.Global)
	} catch (error) {
		outputChannel.appendLine(`[CloudAgent] Failed to clear legacy device token setting: ${getErrorMessage(error)}`)
	}

	// Initialize Cloud Agent ProfileStorageService and migrate legacy config.
	const { ProfileStorageService, setProfileStorageService } = await import(
		"../services/cloud-agent/ProfileStorageService"
	)
	const profileStorage = new ProfileStorageService(context.globalState, context.workspaceState, context.secrets)
	await profileStorage.initialize()
	setProfileStorageService(profileStorage)
	const migratedProfile = await profileStorage.migrateFromLegacyConfig()
	if (migratedProfile) {
		outputChannel.appendLine(
			`[CloudAgent] Migrated legacy config to Profile: ${migratedProfile.name} (${migratedProfile.serverUrl})`,
		)
		void vscode.window.showInformationMessage(
			t("info.cloud_agent_profile_migrated", { name: migratedProfile.name }),
		)
	}
}
