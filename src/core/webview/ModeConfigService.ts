/**
 * ModeConfigService — Interface for mode switching and provider profile management.
 *
 * Phase 1: Defines the contract that ClineProvider already implements inline.
 * Phase 2: ClineProvider delegates to a concrete implementation of this interface,
 * allowing the mode/profile logic to be tested independently.
 */

import type { Mode } from "../../shared/modes"
import type { ProviderSettings, ProviderSettingsEntry } from "@njust-ai-cj/types"

/**
 * Operations for mode switching and provider profile management.
 * ClineProvider implements this contract inline today; this interface
 * exists so the logic can be extracted and tested in isolation.
 */
export interface IModeConfigService {
	handleModeSwitch(newMode: Mode): Promise<void>

	getProviderProfileEntries(): ProviderSettingsEntry[]
	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined
	hasProviderProfileEntry(name: string): boolean

	upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate?: boolean,
	): Promise<string | undefined>

	activateProviderProfile(params: { name: string }): Promise<void>
	deleteProviderProfile(name: string): Promise<void>
	renameProviderProfile(oldName: string, newName: string): Promise<void>
}
