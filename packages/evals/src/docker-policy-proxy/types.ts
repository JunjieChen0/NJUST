/**
 * Docker Policy Proxy — Type Definitions
 *
 * Defines the policy configuration and Docker API request/response types
 * used by the policy engine to validate and filter Docker operations.
 */

/** Policy configuration for the Docker proxy */
export interface PolicyConfig {
	/** Docker images allowed to be created/run */
	allowedImages: string[]

	/** Volume mount sources allowed (host paths) */
	allowedVolumeSources: string[]

	/** Networks containers can attach to */
	allowedNetworks: string[]

	/** Environment variable names that can be passed to containers */
	allowedEnvVarNames: string[]

	/** Maximum memory in bytes (0 = unlimited) */
	maxMemoryBytes: number

	/** Container name prefix that must be used */
	requiredNamePrefix: string
}

/** Docker container creation request (POST /containers/create) */
export interface DockerCreateContainerRequest {
	Image: string
	Env?: string[]
	Cmd?: string[]
	HostConfig?: {
		Binds?: string[]
		Mounts?: Array<{
			Type: string
			Source?: string
			Target: string
			ReadOnly?: boolean
		}>
		NetworkMode?: string
		Privileged?: boolean
		PidMode?: string
		IpcMode?: string
		UsernsMode?: string
		CapAdd?: string[]
		CapDrop?: string[]
		CpuShares?: number
		Memory?: number
		MemorySwap?: number
		NanoCpus?: number
		PidsLimit?: number
		SecurityOpt?: string[]
		Devices?: unknown[]
	}
	Name?: string
	Labels?: Record<string, string>
}

/** Docker container start request (POST /containers/{id}/start) */
export type DockerStartContainerRequest = Record<string, never>

/** Docker container kill request (POST /containers/{id}/kill) */
export interface DockerKillContainerRequest {
	Signal?: string
}

/** Policy decision result */
export interface PolicyDecision {
	allowed: boolean
	reason?: string
}

/** Docker API error response */
export interface DockerErrorResponse {
	message: string
}
