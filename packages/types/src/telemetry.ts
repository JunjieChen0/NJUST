import type { GitRepositoryInfo } from "./git.js"

/**
 * TelemetrySetting
 *
 * User preference for telemetry: enabled, disabled, or unset (default).
 */
export type TelemetrySetting = "enabled" | "disabled" | "unset"

/**
 * TelemetryEventName
 *
 * Known event names for telemetry. Used in settings tracking and analytics.
 */
export const TelemetryEventName = {
	TELEMETRY_SETTINGS_CHANGED: "telemetry_settings_changed",
} as const
export type TelemetryEventName = (typeof TelemetryEventName)[keyof typeof TelemetryEventName]

/**
 * StaticAppProperties
 *
 * Properties that don't change during a session (e.g., extension version).
 */
export interface StaticAppProperties {
	[key: string]: unknown
}

/**
 * DynamicAppProperties
 *
 * Properties that can change during a session (e.g., mode, model).
 */
export interface DynamicAppProperties {
	[key: string]: unknown
}

/**
 * CloudAppProperties
 *
 * Cloud-related properties (auth state, org, etc.). Stub for cloud-stripped builds.
 */
export interface CloudAppProperties {
	[key: string]: unknown
}

/**
 * TaskProperties
 *
 * Task-specific properties (taskId, apiProvider, modelId, etc.).
 */
export interface TaskProperties {
	[key: string]: unknown
}

/**
 * GitProperties
 *
 * Git repository information for telemetry.
 */
export type GitProperties = GitRepositoryInfo

/**
 * TelemetryProperties
 *
 * Combined properties for a telemetry event.
 */
export interface TelemetryProperties {
	[key: string]: unknown
}

/**
 * TelemetryPropertiesProvider
 *
 * Provider that supplies telemetry properties (e.g., ClineProvider).
 * When passing to TelemetryService.setProvider(), wrap as () => provider.getTelemetryProperties().
 */
export interface TelemetryPropertiesProvider {
	getTelemetryProperties(): TelemetryProperties | Promise<TelemetryProperties>
}
