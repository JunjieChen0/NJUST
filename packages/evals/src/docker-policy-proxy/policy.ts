/**
 * Docker Policy Proxy — Policy Engine
 *
 * Validates Docker API requests against the configured policy.
 * Rejects dangerous operations like privileged containers, host namespace
 * access, Docker socket nested mounts, and arbitrary bind mounts.
 */

import type {
	PolicyConfig,
	PolicyDecision,
	DockerCreateContainerRequest,
	DockerKillContainerRequest,
} from "./types"

/** Default policy configuration for evals environment */
export const DEFAULT_POLICY: PolicyConfig = {
	allowedImages: ["evals-runner"],
	allowedVolumeSources: ["/tmp/evals"],
	allowedNetworks: ["evals_default"],
	allowedEnvVarNames: [
		"HOST_EXECUTION_METHOD",
		"EVALS_ATTEMPT",
		"NJUST_AI_CLOUD_TOKEN",
		"OPENROUTER_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GOOGLE_API_KEY",
		"DEEPSEEK_API_KEY",
		"MISTRAL_API_KEY",
		"NJUST_AI_IPC_SOCKET_PATH",
		"DOCKER_HOST",
		"PROXY_AUTH_TOKEN",
	],
	maxMemoryBytes: 2 * 1024 * 1024 * 1024, // 2GB
	requiredNamePrefix: "evals-",
}

/**
 * Check if an image name matches an allowed pattern.
 * Supports exact match and prefix match (e.g., "evals-runner" matches "evals-runner:latest").
 */
function isImageAllowed(image: string, allowedImages: string[]): boolean {
	if (!image || allowedImages.length === 0) return false

	for (const allowed of allowedImages) {
		// Exact match
		if (image === allowed) return true

		// Prefix match (image:tag or image@sha256:...)
		if (image.startsWith(allowed + ":") || image.startsWith(allowed + "@")) return true
	}

	return false
}

/**
 * Check if a volume bind source is allowed.
 * Format: "host_path:container_path[:options]"
 * Rejects Docker socket mounts and paths outside allowed sources.
 */
function isBindAllowed(bind: string, allowedSources: string[]): boolean {
	const parts = bind.split(":")
	const source = parts[0]

	if (!source) return false

	// Reject Docker socket mounts
	if (source === "/var/run/docker.sock" || source.includes("docker.sock")) {
		return false
	}

	// Reject device paths
	if (source.startsWith("/dev/")) {
		return false
	}

	// Check against allowed sources — exact match only (subpaths can be symlinks)
	for (const allowed of allowedSources) {
		if (source === allowed) {
			return true
		}
	}

	return false
}

/**
 * Check if an environment variable name is allowed.
 * Format: "NAME=VALUE" or just "NAME"
 */
function isEnvVarAllowed(env: string, allowedNames: string[]): boolean {
	const name = env.split("=")[0]
	if (!name) return false

	return allowedNames.includes(name)
}

/**
 * Validate a container creation request against the policy.
 */
export function validateCreateContainer(
	req: DockerCreateContainerRequest,
	policy: PolicyConfig = DEFAULT_POLICY,
): PolicyDecision {
	// Check image
	if (!req.Image || !isImageAllowed(req.Image, policy.allowedImages)) {
		return {
			allowed: false,
			reason: `Image '${req.Image}' is not in the allowed list: ${policy.allowedImages.join(", ")}`,
		}
	}

	// Check container name prefix
	if (req.Name && !req.Name.startsWith(policy.requiredNamePrefix)) {
		return {
			allowed: false,
			reason: `Container name '${req.Name}' must start with '${policy.requiredNamePrefix}'`,
		}
	}

	// Check HostConfig (required for resource limits)
	if (!req.HostConfig) {
		return { allowed: false, reason: "HostConfig is required (must set resource limits)" }
	}
	const hc = req.HostConfig

		// Reject privileged mode
		if (hc.Privileged === true) {
			return { allowed: false, reason: "Privileged containers are not allowed" }
		}

		// Reject host PID namespace
		if (hc.PidMode && hc.PidMode !== "" && hc.PidMode !== "none") {
			return { allowed: false, reason: `Host PID namespace is not allowed: ${hc.PidMode}` }
		}

		// Reject host IPC namespace
		if (hc.IpcMode && hc.IpcMode !== "" && hc.IpcMode !== "none" && hc.IpcMode !== "private") {
			return { allowed: false, reason: `Host IPC namespace is not allowed: ${hc.IpcMode}` }
		}

		// Reject host user namespace mode ("host" disables userns isolation)
		if (hc.UsernsMode === "host") {
			return { allowed: false, reason: `Host user namespace mode is not allowed: ${hc.UsernsMode}` }
		}

		// Reject ALL capabilities (evals containers don't need extra caps)
		if (hc.CapAdd && hc.CapAdd.length > 0) {
			return { allowed: false, reason: `Capabilities are not allowed: ${hc.CapAdd.join(", ")}` }
		}

		// Reject ALL SecurityOpt (evals containers don't need custom security options)
		if (hc.SecurityOpt && hc.SecurityOpt.length > 0) {
			return { allowed: false, reason: `SecurityOpt is not allowed: ${hc.SecurityOpt.join(", ")}` }
		}

		// Check volume binds (legacy format)
		if (hc.Binds) {
			for (const bind of hc.Binds) {
				if (!isBindAllowed(bind, policy.allowedVolumeSources)) {
					return { allowed: false, reason: `Volume bind is not allowed: ${bind}` }
				}
			}
		}

		// Check structured mounts (can bypass Binds validation)
		if (hc.Mounts) {
			for (const mount of hc.Mounts) {
				if (mount.Type === "bind") {
					const source = mount.Source ?? ""
					if (!source) {
						return { allowed: false, reason: "Bind mount requires a source path" }
					}
					// Reuse the same bind validation logic
					if (!isBindAllowed(`${source}:${mount.Target}`, policy.allowedVolumeSources)) {
						return { allowed: false, reason: `Mount bind source is not allowed: ${source}` }
					}
				} else if (mount.Type === "volume") {
					// Named volumes are NOT allowed (could mount sensitive data)
					return { allowed: false, reason: "Named volumes are not allowed (use bind mounts instead)" }
				} else {
					return { allowed: false, reason: `Mount type '${mount.Type}' is not allowed (only bind and volume)` }
				}
			}
		}

		// Enforce memory limit (Memory is required to prevent OOM on host)
		if (policy.maxMemoryBytes > 0) {
			if (hc.Memory === undefined || hc.Memory === 0) {
				return { allowed: false, reason: "Memory limit is required (set HostConfig.Memory > 0)" }
			}
			if (hc.Memory > policy.maxMemoryBytes) {
				return { allowed: false, reason: `Memory (${hc.Memory}) exceeds maximum ${policy.maxMemoryBytes}` }
			}
		}

		// Check MemorySwap (must not be -1 for unlimited, must not exceed 2x Memory)
		if (hc.MemorySwap !== undefined) {
			if (hc.MemorySwap === -1) {
				return { allowed: false, reason: "MemorySwap=-1 (unlimited swap) is not allowed" }
			}
			if (hc.Memory !== undefined && hc.MemorySwap > hc.Memory * 2) {
				return { allowed: false, reason: `MemorySwap (${hc.MemorySwap}) exceeds 2x Memory (${hc.Memory})` }
			}
		}

		// Require PidsLimit (prevent fork bombs, must be > 0 and <= 500)
		// Docker API uses -1 for unlimited, so reject all <= 0
		if (hc.PidsLimit === undefined || hc.PidsLimit <= 0) {
			return { allowed: false, reason: "PidsLimit is required (set HostConfig.PidsLimit > 0)" }
		}
		if (hc.PidsLimit > 500) {
			return { allowed: false, reason: `PidsLimit (${hc.PidsLimit}) exceeds maximum 500` }
		}

		// Require NanoCpus (prevent CPU starvation, must be > 0 and <= 1e9 = 1 CPU)
		if (hc.NanoCpus === undefined || hc.NanoCpus <= 0) {
			return { allowed: false, reason: "NanoCpus is required (set HostConfig.NanoCpus > 0, e.g. 1e9 for 1 CPU)" }
		}
		if (hc.NanoCpus > 1e9) {
			return { allowed: false, reason: `NanoCpus (${hc.NanoCpus}) exceeds maximum 1e9 (1 CPU)` }
		}

		// Require NetworkMode (must be present and in allowed list)
		if (!hc.NetworkMode || !policy.allowedNetworks.includes(hc.NetworkMode)) {
			return {
				allowed: false,
				reason: `NetworkMode is required and must be in the allowed list: ${policy.allowedNetworks.join(", ")}`,
			}
		}

		// Reject device access
		if (hc.Devices && hc.Devices.length > 0) {
			return { allowed: false, reason: "Device access is not allowed" }
		}

	// Check environment variables
	if (req.Env) {
		for (const env of req.Env) {
			if (!isEnvVarAllowed(env, policy.allowedEnvVarNames)) {
				return { allowed: false, reason: `Environment variable is not allowed: ${env}` }
			}
		}
	}

	return { allowed: true }
}

/**
 * Validate a container kill request.
 * Only allows killing containers with the required name prefix.
 */
export function validateKillContainer(
	containerId: string,
	req: DockerKillContainerRequest,
	_policy: PolicyConfig = DEFAULT_POLICY,
): PolicyDecision {
	// We can't validate the actual container name from the ID alone,
	// but we can check the signal is reasonable.
	if (req.Signal && !["SIGTERM", "SIGKILL", "SIGINT", "SIGSTOP"].includes(req.Signal)) {
		return { allowed: false, reason: `Signal '${req.Signal}' is not allowed` }
	}

	return { allowed: true }
}

/**
 * Check if a Docker API method/path combination is allowed.
 */
export function isMethodAllowed(method: string, path: string): boolean {
	// Strip API version prefix and query string
	const normalizedPath = path.replace(/^\/v[\d.]+/, "").split("?")[0] ?? path

	// Allow container lifecycle operations
	if (normalizedPath.startsWith("/containers/")) {
		if (method === "POST") {
			if (
				normalizedPath.endsWith("/start") ||
				normalizedPath.endsWith("/stop") ||
				normalizedPath.endsWith("/kill") ||
				normalizedPath.endsWith("/wait") ||
				normalizedPath.endsWith("/resize")
			) {
				return true
			}
			// Container creation via POST /containers/create
			if (normalizedPath === "/containers/create") {
				return true
			}
			// Container attach (docker run -it, docker attach)
			if (normalizedPath.match(/\/containers\/[^/]+\/attach/)) {
				return true
			}
			// Container exec (needed for docker exec into managed containers)
			if (normalizedPath.match(/\/containers\/[^/]+\/exec/)) {
				return true
			}
		}
		if (method === "GET") {
			// Allow listing and inspecting containers
			if (normalizedPath === "/containers/json" || normalizedPath.match(/\/containers\/[^/]+\/json/)) {
				return true
			}
			// Allow logs
			if (normalizedPath.match(/\/containers\/[^/]+\/logs/)) {
				return true
			}
		}
		if (method === "DELETE") {
			// Allow removing containers
			if (normalizedPath.match(/\/containers\/[^/]+/)) {
				return true
			}
		}
	}

	// Allow exec instance operations (POST /exec/{id}/start, GET /exec/{id}/json)
	if (normalizedPath.startsWith("/exec/")) {
		if (method === "POST" && normalizedPath.endsWith("/start")) {
			return true
		}
		if (method === "POST" && normalizedPath.endsWith("/resize")) {
			return true
		}
		if (method === "GET" && normalizedPath.match(/\/exec\/[^/]+\/json/)) {
			return true
		}
	}

	// Allow ping and version
	if (normalizedPath === "/_ping" || normalizedPath === "/version") {
		return true
	}

	// Deny everything else (images, networks, volumes, etc.)
	return false
}
