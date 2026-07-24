import { describe, expect, it } from "vitest"

import {
	DEFAULT_SANDBOX_SETTINGS,
	SANDBOX_LIMITS,
	parseSandboxExtensionMessage,
	sandboxDockerImageSchema,
	sandboxSettingsSchema,
	sandboxWebviewMessageSchema,
} from "../sandbox.js"
import { safeParseWebviewMessage } from "../vscode-extension-host.js"

describe("sandbox settings schema", () => {
	it("accepts the shared defaults", () => {
		expect(sandboxSettingsSchema.parse(DEFAULT_SANDBOX_SETTINGS)).toEqual(DEFAULT_SANDBOX_SETTINGS)
	})

	it.each([
		["memoryMb", SANDBOX_LIMITS.memoryMb.min - 1],
		["memoryMb", 64.5],
		["cpuLimit", Number.POSITIVE_INFINITY],
		["pidsLimit", SANDBOX_LIMITS.pidsLimit.max + 1],
		["timeoutSeconds", Number.NaN],
	] as const)("rejects invalid %s values", (field, value) => {
		expect(sandboxSettingsSchema.safeParse({ ...DEFAULT_SANDBOX_SETTINGS, [field]: value }).success).toBe(false)
	})

	it("uses the same strict Docker image grammar for settings and actions", () => {
		expect(sandboxDockerImageSchema.safeParse("registry.example.com/team/image:Release-1").success).toBe(true)
		expect(sandboxDockerImageSchema.safeParse(" docker.io/library/node:20 ").success).toBe(false)
		expect(sandboxDockerImageSchema.safeParse("docker:dind").success).toBe(false)
		expect(sandboxDockerImageSchema.safeParse("privileged-runner:latest").success).toBe(false)
	})
})

describe("sandbox message schemas", () => {
	it("requires requestId and the dedicated image field for pull requests", () => {
		expect(
			sandboxWebviewMessageSchema.safeParse({
				type: "sandboxPullImage",
				requestId: "pull-1",
				image: "njust-ai/sandbox:latest",
			}).success,
		).toBe(true)

		expect(
			sandboxWebviewMessageSchema.safeParse({
				type: "sandboxPullImage",
				requestId: "pull-1",
				text: "njust-ai/sandbox:latest",
			}).success,
		).toBe(false)
	})

	it("enforces the sandbox payload schema at the main webview message boundary", () => {
		expect(
			safeParseWebviewMessage({
				type: "sandboxPullImage",
				requestId: "pull-1",
				image: "njust-ai/sandbox:latest",
			}),
		).not.toBeNull()
		expect(safeParseWebviewMessage({ type: "sandboxPullImage", text: "njust-ai/sandbox:latest" })).toBeNull()
		expect(safeParseWebviewMessage({ type: "sandboxTest" })).toBeNull()
	})

	it("parses structured extension responses and rejects legacy flat responses", () => {
		expect(
			parseSandboxExtensionMessage({
				type: "sandboxCleanupResult",
				requestId: "cleanup-1",
				payload: { success: true, count: 2, message: "Cleaned 2 stale containers" },
			}),
		).toEqual({
			type: "sandboxCleanupResult",
			requestId: "cleanup-1",
			payload: { success: true, count: 2, message: "Cleaned 2 stale containers" },
		})

		expect(
			parseSandboxExtensionMessage({
				type: "sandboxCleanupResult",
				requestId: "cleanup-1",
				count: 2,
				message: "legacy",
			}),
		).toBeNull()
	})

	it("does not permit a failed cleanup to masquerade as a successful zero-count cleanup", () => {
		expect(
			parseSandboxExtensionMessage({
				type: "sandboxCleanupResult",
				requestId: "cleanup-1",
				payload: { success: false, count: 0, message: "Cleanup failed" },
			}),
		).toBeNull()
	})
})
