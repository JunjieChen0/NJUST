/**
 * Sandbox security policy engine.
 *
 * Determines which execution backend to use for a given command and
 * enforces fail-closed semantics: if Docker is configured but unavailable,
 * execution is denied rather than silently falling back to the host.
 *
 * The `allowFallbackToHost` setting is fixed at `false` and cannot be
 * overridden by configuration.
 */

import { logger } from "../../shared/logger"
import type { CommandSource, ExecutionBackend } from "./CommandRunner"
import { PolicyDeniedError } from "./SandboxErrors"

/**
 * Current Docker availability status.
 */
export type DockerStatus = "available" | "daemon-not-running" | "not-installed" | "checking"

/**
 * Policy decision result.
 */
export interface PolicyDecision {
	/** The backend to use. */
	backend: ExecutionBackend

	/** Whether the policy explicitly approved the execution. */
	approved: boolean

	/** Reason for the decision (for audit logging). */
	reason: string
}

/**
 * Configuration subset needed by the policy engine.
 * This decouples the policy from the full SandboxSettings type.
 */
export interface PolicyConfig {
	/** Configured backend. */
	backend: ExecutionBackend

	/** Current Docker availability. */
	dockerStatus: DockerStatus
}

/**
 * Evaluate the sandbox policy for a command execution request.
 *
 * **Fail-closed rules:**
 * 1. If `backend === "docker"` and Docker is available → use Docker.
 * 2. If `backend === "docker"` and Docker is NOT available → **deny** (no fallback).
 * 3. If `backend === "guarded-host"` → always use guarded-host.
 *
 * @param config - Current sandbox configuration.
 * @param source - Where the command originated from.
 * @returns The policy decision.
 * @throws {PolicyDeniedError} If Docker is required but unavailable.
 */
export function evaluatePolicy(config: PolicyConfig, source: CommandSource): PolicyDecision {
	// Guarded-host mode: always approved
	if (config.backend === "guarded-host") {
		return {
			backend: "guarded-host",
			approved: true,
			reason: "Guarded-host backend configured",
		}
	}

	// Docker mode: check availability
	if (config.backend === "docker") {
		if (config.dockerStatus === "available") {
			return {
				backend: "docker",
				approved: true,
				reason: `Docker available, source=${source}`,
			}
		}

		// Fail closed — do NOT silently fall back to host
		const reason =
			`Docker backend required but status is "${config.dockerStatus}". ` +
			`Execution denied (allowFallbackToHost is fixed false).`

		logger.error("SandboxPolicy", "fail_closed", {
			source,
			dockerStatus: config.dockerStatus,
			reason,
		})

		throw new PolicyDeniedError(reason)
	}

	// Unknown backend — should never happen, fail closed
	const unknownReason = `Unknown backend: ${config.backend}`
	logger.error("SandboxPolicy", "unknown_backend", { backend: config.backend })
	throw new PolicyDeniedError(unknownReason)
}

/**
 * Check whether a given command source is allowed to use a specific backend.
 *
 * Cloud Agent and MCP sources should prefer Docker when configured.
 * Internal sources always use guarded-host.
 */
export function resolveBackendForSource(configuredBackend: ExecutionBackend, source: CommandSource): ExecutionBackend {
	// Internal commands always run on host (git, ripgrep, etc.)
	if (source === "internal") {
		return "guarded-host"
	}

	// All other sources use the configured backend
	return configuredBackend
}
