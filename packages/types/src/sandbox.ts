import { z } from "zod"

export const SANDBOX_LIMITS = {
	memoryMb: { min: 64, max: 4096, default: 512, step: 1 },
	cpuLimit: { min: 0.1, max: 8, default: 1, step: 0.1 },
	pidsLimit: { min: 16, max: 4096, default: 256, step: 1 },
	timeoutSeconds: { min: 5, max: 3600, default: 120, step: 1 },
} as const

export const sandboxBackendSchema = z.enum(["guarded-host", "docker"])
export type SandboxBackend = z.infer<typeof sandboxBackendSchema>

export const sandboxNetworkModeSchema = z.enum(["none", "bridge"])
export type SandboxNetworkMode = z.infer<typeof sandboxNetworkModeSchema>

export const sandboxWorkspaceAccessSchema = z.enum(["read-only", "read-write"])
export type SandboxWorkspaceAccess = z.infer<typeof sandboxWorkspaceAccessSchema>

export const sandboxDockerStatusSchema = z.enum([
	"available",
	"daemon-not-running",
	"not-installed",
	"checking",
	"unknown",
])
export type SandboxDockerStatus = z.infer<typeof sandboxDockerStatusSchema>

/**
 * Docker image grammar accepted by the sandbox host. Repository components are
 * lowercase; tags may contain uppercase characters, matching Docker's format.
 */
export const SANDBOX_DOCKER_IMAGE_PATTERN =
	/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/

export const sandboxDockerImageSchema = z
	.string()
	.min(1, "Docker image name cannot be empty")
	.regex(SANDBOX_DOCKER_IMAGE_PATTERN, "Invalid Docker image reference")
	.refine((image) => image.trim() === image, "Docker image name cannot start or end with whitespace")
	.refine(
		(image) => !image.includes("docker:dind") && !image.includes("privileged"),
		"Docker image is not allowed for security reasons",
	)

const finiteIntegerInRange = (min: number, max: number) => z.number().finite().int().min(min).max(max)
const finiteNumberInRange = (min: number, max: number) => z.number().finite().min(min).max(max)

export const sandboxSettingsSchema = z
	.object({
		backend: sandboxBackendSchema,
		dockerImage: sandboxDockerImageSchema,
		networkMode: sandboxNetworkModeSchema,
		workspaceAccess: sandboxWorkspaceAccessSchema,
		memoryMb: finiteIntegerInRange(SANDBOX_LIMITS.memoryMb.min, SANDBOX_LIMITS.memoryMb.max),
		cpuLimit: finiteNumberInRange(SANDBOX_LIMITS.cpuLimit.min, SANDBOX_LIMITS.cpuLimit.max),
		pidsLimit: finiteIntegerInRange(SANDBOX_LIMITS.pidsLimit.min, SANDBOX_LIMITS.pidsLimit.max),
		timeoutSeconds: finiteIntegerInRange(SANDBOX_LIMITS.timeoutSeconds.min, SANDBOX_LIMITS.timeoutSeconds.max),
		taskScopedContainer: z.boolean(),
	})
	.strict()

export type SandboxSettings = z.infer<typeof sandboxSettingsSchema>

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = Object.freeze({
	backend: "guarded-host",
	dockerImage: "njust-ai/sandbox:latest",
	networkMode: "none",
	workspaceAccess: "read-write",
	memoryMb: SANDBOX_LIMITS.memoryMb.default,
	cpuLimit: SANDBOX_LIMITS.cpuLimit.default,
	pidsLimit: SANDBOX_LIMITS.pidsLimit.default,
	timeoutSeconds: SANDBOX_LIMITS.timeoutSeconds.default,
	taskScopedContainer: true,
})

/** Flattened sandbox fields carried in ExtensionState and updateSettings. */
export interface SandboxSettingsUpdate {
	sandboxBackend: SandboxBackend
	sandboxDockerImage: string
	sandboxNetworkMode: SandboxNetworkMode
	sandboxWorkspaceAccess: SandboxWorkspaceAccess
	sandboxMemoryMb: number
	sandboxCpuLimit: number
	sandboxPidsLimit: number
	sandboxTimeoutSeconds: number
	sandboxTaskScopedContainer: boolean
}

export interface SandboxExtensionState extends Partial<SandboxSettingsUpdate> {
	sandboxDockerStatus?: SandboxDockerStatus
}

const sandboxRequestIdSchema = z.string().min(1).max(128)

export const SANDBOX_WEBVIEW_MESSAGE_TYPES = ["sandboxTest", "sandboxCleanup", "sandboxPullImage"] as const

export const sandboxWebviewMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("sandboxTest"), requestId: sandboxRequestIdSchema }).strict(),
	z.object({ type: z.literal("sandboxCleanup"), requestId: sandboxRequestIdSchema }).strict(),
	z
		.object({
			type: z.literal("sandboxPullImage"),
			requestId: sandboxRequestIdSchema,
			image: sandboxDockerImageSchema,
		})
		.strict(),
])

export type SandboxWebviewMessage = z.infer<typeof sandboxWebviewMessageSchema>

const sandboxTestPayloadSchema = z
	.object({
		success: z.boolean(),
		status: sandboxDockerStatusSchema,
		message: z.string().min(1),
	})
	.strict()

const sandboxCleanupPayloadSchema = z.discriminatedUnion("success", [
	z.object({ success: z.literal(true), count: z.number().int().nonnegative(), message: z.string().min(1) }).strict(),
	z.object({ success: z.literal(false), message: z.string().min(1) }).strict(),
])

const sandboxPullCompletePayloadSchema = z
	.object({
		success: z.boolean(),
		image: z.string(),
		message: z.string().min(1),
	})
	.strict()

export const SANDBOX_EXTENSION_MESSAGE_TYPES = [
	"sandboxTestResult",
	"sandboxCleanupResult",
	"sandboxPullProgress",
	"sandboxPullComplete",
] as const

export const sandboxExtensionMessageSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("sandboxTestResult"),
			requestId: sandboxRequestIdSchema,
			payload: sandboxTestPayloadSchema,
		})
		.strict(),
	z
		.object({
			type: z.literal("sandboxCleanupResult"),
			requestId: sandboxRequestIdSchema,
			payload: sandboxCleanupPayloadSchema,
		})
		.strict(),
	z
		.object({
			type: z.literal("sandboxPullProgress"),
			requestId: sandboxRequestIdSchema,
			payload: z.object({ image: z.string(), line: z.string() }).strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("sandboxPullComplete"),
			requestId: sandboxRequestIdSchema,
			payload: sandboxPullCompletePayloadSchema,
		})
		.strict(),
])

export type SandboxExtensionMessage = z.infer<typeof sandboxExtensionMessageSchema>

export function parseSandboxExtensionMessage(raw: unknown): SandboxExtensionMessage | null {
	const result = sandboxExtensionMessageSchema.safeParse(raw)
	return result.success ? result.data : null
}
