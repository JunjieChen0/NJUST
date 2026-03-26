import * as vscode from "vscode"
import { Package } from "../../../shared/package"

/** Default API wait time (seconds). Local providers (Ollama/LM Studio) may need a higher value in settings. */
const DEFAULT_API_REQUEST_TIMEOUT_SEC = 300

/**
 * Gets the API request timeout from VSCode configuration with validation.
 *
 * @returns The timeout in milliseconds. Returns undefined to disable timeout
 *          (letting the SDK use its default), or a positive number for explicit timeout.
 */
export function getApiRequestTimeout(): number | undefined {
	// Get timeout with validation to ensure it's a valid non-negative number
	const configTimeout = vscode.workspace
		.getConfiguration(Package.name)
		.get<number>("apiRequestTimeout", DEFAULT_API_REQUEST_TIMEOUT_SEC)

	// Validate that it's actually a number and not NaN
	if (typeof configTimeout !== "number" || isNaN(configTimeout)) {
		return DEFAULT_API_REQUEST_TIMEOUT_SEC * 1000
	}

	// 0 or negative means "no timeout" - return undefined to let SDK use its default
	// (OpenAI SDK interprets 0 as "abort immediately", so we return undefined instead)
	if (configTimeout <= 0) {
		return undefined
	}

	return configTimeout * 1000 // Convert to milliseconds
}
