/**
 * ConfigurationSyncService — Manages provider profiles, mode configuration,
 * and API configuration synchronization.
 *
 * Extracted from ClineProvider.ts to decompose the monolithic file.
 *
 * Phase 1: Interface + helpers for provider profile management.
 * Phase 2: Full extraction of mode switching, profile activation,
 * and custom instructions management from ClineProvider.
 */
import * as vscode from "vscode"

import type { ProviderSettings, ProviderSettingsEntry } from "@njust-ai-cj/types"
import { NJUST_AI_CJEventName, getModelId } from "@njust-ai-cj/types"
import { TelemetryService } from "@njust-ai-cj/telemetry"

import type { Mode } from "../../shared/modes"
import { t } from "../../i18n"
import { cangjieDiagnosticModeSwitch } from "../../services/cangjie-lsp/cangjieDiagnosticModeSwitch"

export { type ProviderSettingsEntry }

/**
 * Service interface for provider profile and mode configuration management.
 * ClineProvider implements this surface; extracted consumers should depend
 * on this interface rather than ClineProvider directly.
 */
export interface IConfigurationSyncService {
	getProviderProfileEntries(): ProviderSettingsEntry[]
	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined
	hasProviderProfileEntry(name: string): boolean

	upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate?: boolean,
	): Promise<string | undefined>

	deleteProviderProfile(profileToDelete: ProviderSettingsEntry): Promise<void>

	activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	): Promise<void>

	handleModeSwitch(newMode: string): Promise<void>
	updateCustomInstructions(instructions?: string): Promise<void>
}

/**
 * Concrete implementation that delegates back to the ClineProvider host.
 * All `this.X` references from the original ClineProvider methods become `h.X`.
 */
export class ConfigurationSyncService {
	constructor(private host: any) {}

	async handleModeSwitch(newMode: Mode): Promise<void> {
		const h = this.host
		await this.clearCangjieDiagnosticsIfNeeded(newMode)
		await this.persistTaskModeSwitch(newMode)
		await h.updateGlobalState("mode", newMode)

		h.emit(NJUST_AI_CJEventName.ModeChanged, newMode)

		const lockApiConfigAcrossModes = h.context.workspaceState.get("lockApiConfigAcrossModes", false)
		if (lockApiConfigAcrossModes) {
			await h.postStateToWebview()
			return
		}

		await this.syncModeProviderProfile(newMode)
		await h.postStateToWebview()
	}

	private async clearCangjieDiagnosticsIfNeeded(newMode: Mode): Promise<void> {
		const h = this.host
		const previousMode = (await h.getGlobalState("mode")) as Mode | undefined
		if (previousMode === "cangjie" && newMode !== "cangjie") {
			cangjieDiagnosticModeSwitch.clearExtensionCangjieDiagnostics()
		}
	}

	private async persistTaskModeSwitch(newMode: Mode): Promise<void> {
		const h = this.host
		const task = h.getCurrentTask()
		if (!task) {
			return
		}

		TelemetryService.instance.captureModeSwitch(task.taskId, newMode)
		task.emit(NJUST_AI_CJEventName.TaskModeSwitched, task.taskId, newMode)

		try {
			const taskHistoryItem =
				h.taskHistoryStore.get(task.taskId) ??
				(h.getGlobalState("taskHistory") ?? []).find((item: any) => item.id === task.taskId)

			if (taskHistoryItem) {
				await h.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
			}

			;(task as any)._taskMode = newMode
		} catch (error) {
			h.log(
				`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
			)
			throw error
		}
	}

	private async syncModeProviderProfile(newMode: Mode): Promise<void> {
		const h = this.host
		const [savedConfigId, listApiConfig] = await Promise.all([
			h.providerSettingsManager.getModeConfigId(newMode),
			h.providerSettingsManager.listConfig(),
		])

		await h.updateGlobalState("listApiConfigMeta", listApiConfig)

		if (savedConfigId) {
			await this.activateModeSavedProfile(newMode, listApiConfig, savedConfigId)
			return
		}

		const currentApiConfigNameAfter = h.getGlobalState("currentApiConfigName")
		if (!currentApiConfigNameAfter) {
			return
		}

		const config = listApiConfig.find((c: any) => c.name === currentApiConfigNameAfter)
		if (config?.id) {
			await h.providerSettingsManager.setModeConfig(newMode, config.id)
		}
	}

	private async activateModeSavedProfile(
		newMode: Mode,
		listApiConfig: ProviderSettingsEntry[],
		savedConfigId: string,
	): Promise<void> {
		const h = this.host
		const profile = listApiConfig.find(({ id }) => id === savedConfigId)
		if (!profile?.name) {
			return
		}

		const fullProfile = await h.providerSettingsManager.getProfile({ name: profile.name })
		if (!fullProfile.apiProvider) {
			return
		}

		await this.activateProviderProfile({ name: profile.name })
	}

	updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const h = this.host
		const task = h.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)

		const needsRebuild = forceRebuild || prevProvider !== newProvider || prevModelId !== newModelId

		if (needsRebuild) {
			task.updateApiConfiguration(providerSettings)
		} else {
			;(task as any).apiConfiguration = providerSettings
		}
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		const h = this.host
		return h.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile: ProviderSettingsEntry) => profile.name === name)
	}

	hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		const h = this.host
		try {
			const id = await h.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await h.getState()

				await Promise.all([
					h.updateGlobalState("listApiConfigMeta", await h.providerSettingsManager.listConfig()),
					h.updateGlobalState("currentApiConfigName", name),
					h.providerSettingsManager.setModeConfig(mode, id),
					h.contextProxy.setProviderSettings(providerSettings),
				])

				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await h.updateGlobalState("listApiConfigMeta", await h.providerSettingsManager.listConfig())
			}

			await h.postStateToWebview()
			return id
		} catch (error) {
			h.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
			return undefined
		}
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry): Promise<void> {
		const h = this.host
		const globalSettings = h.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await h.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await h.postStateToWebview()
	}

	async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const h = this.host
		const task = h.getCurrentTask()
		if (!task) {
			return
		}

		try {
			task.setTaskApiConfigName(apiConfigName)
			await this.persistCurrentTaskProfileName(task.taskId, apiConfigName)
		} catch (error) {
			h.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	async persistCurrentTaskProfileName(taskId: string, apiConfigName: string): Promise<void> {
		const h = this.host
		const taskHistoryItem =
			h.taskHistoryStore.get(taskId) ?? (h.getGlobalState("taskHistory") ?? []).find((item: any) => item.id === taskId)

		if (taskHistoryItem) {
			await h.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	): Promise<void> {
		const h = this.host
		const { name, id, ...providerSettings } = await h.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true
		const listApiConfig = await h.providerSettingsManager.listConfig()

		await Promise.all([
			h.contextProxy.setValue("listApiConfigMeta", listApiConfig),
			h.contextProxy.setValue("currentApiConfigName", name),
			h.contextProxy.setProviderSettings(providerSettings),
		])

		await this.persistActivatedProfileModeBinding(id, persistModeConfig)
		this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		await h.postStateToWebview()

		if (providerSettings.apiProvider) {
			h.emit(NJUST_AI_CJEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	async persistActivatedProfileModeBinding(id: string | undefined, persistModeConfig: boolean): Promise<void> {
		const h = this.host
		if (!id || !persistModeConfig) {
			return
		}

		const { mode } = await h.getState()
		await h.providerSettingsManager.setModeConfig(mode, id)
	}

	async updateCustomInstructions(instructions?: string): Promise<void> {
		const h = this.host
		await h.updateGlobalState("customInstructions", instructions || undefined)
		await h.postStateToWebview()
	}
}
