import type * as vscode from "vscode"

import { parseExtensionSetting, type ExtensionSettingKey, type ExtensionSettingValue } from "@njust-ai/types"

/**
 * Read and validate an extension setting against the schema generated from
 * src/package.json. New call sites should use this instead of scattering raw
 * `config.get<T>()` calls and duplicated defaults through the codebase.
 */
export function getExtensionSetting<K extends ExtensionSettingKey>(
	config: vscode.WorkspaceConfiguration,
	key: K,
): ExtensionSettingValue<K> {
	return parseExtensionSetting(key, config.get<unknown>(key))
}
