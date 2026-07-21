/**
 * Sandbox configuration — type-safe, default-safe settings model.
 *
 * Reads from VS Code settings (`njust-ai.sandbox.*`) and validates all values.
 * Invalid values are rejected with descriptive errors rather than silently
 * corrected.
 *
 * Security constraints:
 * - Docker image names are validated against a strict regex
 * - Privileged mode, host network/PID/IPC are always forbidden
 * - Docker Socket, `/`, `~`, `/etc` mounts are always forbidden
 * - Resource limits have strict ranges; out-of-range values are rejected
 * - `allowFallbackToHost` is fixed at `false` and cannot be configured
 */

import * as vscode from "vscode"
import * as os from "os"
import * as path from "path"
import {
	DEFAULT_SANDBOX_SETTINGS,
	sandboxDockerImageSchema,
	sandboxSettingsSchema,
	type SandboxNetworkMode,
	type SandboxSettings as SharedSandboxSettings,
	type SandboxWorkspaceAccess,
} from "@njust-ai/types"
import { logger } from "../../shared/logger"
import { ConfigInvalidError } from "./SandboxErrors"

// ─── Types ───────────────────────────────────────────────────────────────────

export type NetworkMode = SandboxNetworkMode
export type WorkspaceAccess = SandboxWorkspaceAccess

/**
 * Complete sandbox settings.
 * All fields have defaults and are validated on construction.
 */
export interface SandboxSettings extends SharedSandboxSettings {
	/**
	 * Whether to allow fallback to host when Docker is unavailable.
	 * **Fixed at `false`** — cannot be configured.
	 */
	readonly allowFallbackToHost: false
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default sandbox settings. */
export const DEFAULT_SETTINGS: SandboxSettings = Object.freeze({
	...DEFAULT_SANDBOX_SETTINGS,
	allowFallbackToHost: false,
})

/** VS Code configuration key prefix. */
const CONFIG_PREFIX = "njust-ai.sandbox"

/** Mount paths that are always forbidden. */
const FORBIDDEN_MOUNT_PATHS = ["/var/run/docker.sock", "/", "~", "/etc", "/proc", "/sys", "/dev"]

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a Docker image reference.
 * @throws {ConfigInvalidError} If the image reference is invalid.
 */
export function validateDockerImage(image: string): void {
	const result = sandboxDockerImageSchema.safeParse(image)
	if (!result.success) {
		throw new ConfigInvalidError(result.error.issues.map((issue) => issue.message).join("; "))
	}
}

/**
 * Validate a mount path is not in the forbidden list.
 * @throws {ConfigInvalidError} If the path is forbidden.
 */
export function validateMountPath(mountPath: string): void {
	if (typeof mountPath !== "string" || mountPath.trim().length === 0) {
		throw new ConfigInvalidError("Mount path must be a non-empty absolute path")
	}

	const trimmed = mountPath.trim()
	const hasUnsupportedCharacter = Array.from(trimmed).some((character) => {
		const code = character.charCodeAt(0)
		return code <= 0x1f || code === 0x7f || character === "," || character === '"'
	})
	if (hasUnsupportedCharacter) {
		throw new ConfigInvalidError(`Mount path "${mountPath}" contains unsupported characters`)
	}

	const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(trimmed)
	const isUncOrDevice = /^(?:\\\\|\/\/)/.test(trimmed)
	if (isUncOrDevice) {
		throw new ConfigInvalidError(`UNC and Windows device paths are forbidden: "${mountPath}"`)
	}
	if (!isWindowsPath && !pathModuleIsAbsolute(trimmed)) {
		throw new ConfigInvalidError(`Mount path must be absolute: "${mountPath}"`)
	}

	const normalized = isWindowsPath
		? path.win32
				.normalize(trimmed)
				.replace(/[\\/]+$/, "")
				.toLowerCase()
		: path.posix.normalize(trimmed).replace(/\/+$/, "") || "/"
	const windowsRoot = isWindowsPath && /^[a-z]:$/.test(normalized)
	if (windowsRoot || FORBIDDEN_MOUNT_PATHS.includes(normalized)) {
		throw new ConfigInvalidError(
			`Mount path "${mountPath}" is forbidden. Blocked paths: ${FORBIDDEN_MOUNT_PATHS.join(", ")}`,
		)
	}

	const posixSystemRoot = ["/etc", "/proc", "/sys", "/dev"].some(
		(root) => normalized === root || normalized.startsWith(`${root}/`),
	)
	if (posixSystemRoot) {
		throw new ConfigInvalidError(`System mount path "${mountPath}" is forbidden`)
	}

	const home = os.homedir()
	if (home) {
		const normalizedHome = /^[a-zA-Z]:[\\/]/.test(home)
			? path.win32
					.normalize(home)
					.replace(/[\\/]+$/, "")
					.toLowerCase()
			: path.posix.normalize(home).replace(/\/+$/, "") || "/"
		if (normalized === normalizedHome) {
			throw new ConfigInvalidError(`Mounting the user home root is forbidden: "${mountPath}"`)
		}
	}

	// Block Docker socket variants
	if (
		normalized.includes("docker.sock") ||
		normalized.includes("docker_engine") ||
		normalized.includes("/docker") ||
		normalized.includes("\\docker") ||
		normalized.endsWith("/docker") ||
		normalized.endsWith("\\docker")
	) {
		throw new ConfigInvalidError(`Mount path "${mountPath}" appears to reference the Docker socket`)
	}
}

function pathModuleIsAbsolute(value: string): boolean {
	return path.posix.isAbsolute(value)
}

/**
 * Validate that no forbidden Docker options are present.
 * These options are always blocked regardless of configuration.
 */
export function validateNoPrivilegeEscalation(options: {
	privileged?: boolean
	networkMode?: string
	pidMode?: string
	ipcMode?: string
	capAdd?: string[]
	devices?: string[]
}): void {
	if (options.privileged) {
		throw new ConfigInvalidError("Privileged mode is forbidden")
	}

	if (options.networkMode === "host") {
		throw new ConfigInvalidError("Host network mode is forbidden. Use 'none' or 'bridge'")
	}

	if (options.pidMode === "host") {
		throw new ConfigInvalidError("Host PID mode is forbidden")
	}

	if (options.ipcMode === "host") {
		throw new ConfigInvalidError("Host IPC mode is forbidden")
	}

	if (options.capAdd?.length) {
		throw new ConfigInvalidError(`Adding capabilities is forbidden: ${options.capAdd.join(", ")}`)
	}

	if (options.devices?.length) {
		throw new ConfigInvalidError(`Device mounting is forbidden: ${options.devices.join(", ")}`)
	}
}

// ─── Configuration Reader ────────────────────────────────────────────────────

/**
 * Read and validate sandbox settings from VS Code configuration.
 *
 * Invalid values are rejected; callers must fail closed.
 * The `allowFallbackToHost` setting is always `false`.
 */
export function readSandboxSettings(): SandboxSettings {
	const config = vscode.workspace.getConfiguration(CONFIG_PREFIX)

	// Read raw values with defaults
	const raw: Record<string, unknown> = {
		backend: config.get<string>("backend", DEFAULT_SETTINGS.backend),
		dockerImage: config.get<string>("dockerImage", DEFAULT_SETTINGS.dockerImage),
		networkMode: config.get<string>("networkMode", DEFAULT_SETTINGS.networkMode),
		workspaceAccess: config.get<string>("workspaceAccess", DEFAULT_SETTINGS.workspaceAccess),
		memoryMb: config.get<number>("memoryMb", DEFAULT_SETTINGS.memoryMb),
		cpuLimit: config.get<number>("cpuLimit", DEFAULT_SETTINGS.cpuLimit),
		pidsLimit: config.get<number>("pidsLimit", DEFAULT_SETTINGS.pidsLimit),
		timeoutSeconds: config.get<number>("timeoutSeconds", DEFAULT_SETTINGS.timeoutSeconds),
		taskScopedContainer: config.get<boolean>("taskScopedContainer", DEFAULT_SETTINGS.taskScopedContainer),
	}

	// Validate the complete effective settings object.
	return buildValidatedSettings(raw)
}

/**
 * Validate a raw settings object and produce a validated SandboxSettings.
 * Used both for VS Code config reading and programmatic construction.
 *
 * @throws {ConfigInvalidError} If a required value is invalid.
 */
export function buildValidatedSettings(raw: Record<string, unknown>): SandboxSettings {
	const valueOrDefault = <K extends keyof SharedSandboxSettings>(key: K): unknown =>
		raw[key] === undefined ? DEFAULT_SANDBOX_SETTINGS[key] : raw[key]
	const candidate = {
		backend: valueOrDefault("backend"),
		dockerImage: valueOrDefault("dockerImage"),
		networkMode: valueOrDefault("networkMode"),
		workspaceAccess: valueOrDefault("workspaceAccess"),
		memoryMb: valueOrDefault("memoryMb"),
		cpuLimit: valueOrDefault("cpuLimit"),
		pidsLimit: valueOrDefault("pidsLimit"),
		timeoutSeconds: valueOrDefault("timeoutSeconds"),
		taskScopedContainer: valueOrDefault("taskScopedContainer"),
	}
	const result = sandboxSettingsSchema.safeParse(candidate)
	if (!result.success) {
		const message = result.error.issues
			.map((issue) => `${issue.path.join(".") || "sandbox settings"}: ${issue.message}`)
			.join("; ")
		throw new ConfigInvalidError(message)
	}

	return { ...result.data, allowFallbackToHost: false }
}

// ─── Config Provider for SandboxExecutionService ─────────────────────────────

import type { SandboxConfigProvider } from "./SandboxExecutionService"
import type { DockerStatus } from "./SandboxPolicy"

/**
 * VS Code-backed configuration provider for SandboxExecutionService.
 *
 * Reads settings from `njust-ai.sandbox.*` and exposes them to the
 * execution service. Docker status is updated via `updateDockerStatus()`.
 */
export class VSCodeSandboxConfigProvider implements SandboxConfigProvider {
	private dockerStatus: DockerStatus = "checking"

	getBackend(): SharedSandboxSettings["backend"] {
		return readSandboxSettings().backend
	}

	getDockerStatus(): DockerStatus {
		return this.dockerStatus
	}

	getTimeoutSeconds(): number {
		return readSandboxSettings().timeoutSeconds
	}

	/**
	 * Update the cached Docker availability status.
	 * Called by Docker detection logic or manual refresh.
	 */
	updateDockerStatus(status: DockerStatus): void {
		this.dockerStatus = status
		logger.info("VSCodeSandboxConfigProvider", "Docker status updated", { status })
	}

	/**
	 * Read full sandbox settings (for use outside the execution service).
	 */
	getSettings(): SandboxSettings {
		return readSandboxSettings()
	}
}
