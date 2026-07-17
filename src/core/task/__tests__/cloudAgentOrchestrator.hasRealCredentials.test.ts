import { describe, it, expect, afterEach } from "vitest"
import type { CloudAgentProfile } from "../../../services/cloud-agent/types/profile"
import { setDeviceToken } from "../../../services/cloud-agent/deviceToken"

import { CloudAgentOrchestrator } from "../CloudAgentOrchestrator"

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Access private hasRealCredentials method via type-cast.
 */
function hasRealCredentials(server: CloudAgentOrchestrator, profile: CloudAgentProfile): boolean {
	return (server as unknown as { hasRealCredentials: (p: CloudAgentProfile) => boolean }).hasRealCredentials(profile)
}

function createProfile(auth?: Partial<CloudAgentProfile["auth"]> & { type: CloudAgentProfile["auth"]["type"] }): CloudAgentProfile {
	return {
		id: "test-profile",
		name: "Test Profile",
		protocolType: "rest",
		serverUrl: "http://localhost:4000",
		auth: auth as CloudAgentProfile["auth"],
	}
}

// ─── Mock host for instantiation ────────────────────────────────────────────

const mockHost = {
	taskId: "test-task",
	abort: false,
	setCurrentRequestAbortController: () => {},
	say: async () => {},
	ask: async () => "",
	getWorkspacePath: () => "/workspace",
} as any

const mockService = {
	deferredConstants: { maxDurationMs: 600000 },
	startDeferred: async () => ({ status: "done", run_id: "r1" }),
	resumeDeferred: async () => ({ status: "done" }),
	sendDeferredAbort: async () => {},
	parseWorkspaceOps: () => ({ operations: [], error: undefined }),
} as any

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CloudAgentOrchestrator.hasRealCredentials", () => {
	let orchestrator: CloudAgentOrchestrator

	afterEach(() => {
		// Reset global device token after each test
		setDeviceToken("")
	})

	it("returns false when auth is undefined", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile()
		profile.auth = undefined
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for api-key with non-empty apiKey", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "api-key", apiKey: "sk-test-123" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for api-key with empty apiKey", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "api-key", apiKey: "" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns false for api-key with whitespace-only apiKey", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "api-key", apiKey: "   " })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns false for api-key with missing apiKey", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "api-key" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for bearer with non-empty bearerToken", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "bearer", bearerToken: "tok-123" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for bearer with empty bearerToken", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "bearer", bearerToken: "" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for basic with non-empty basicPassword", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "basic", basicPassword: "pass" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for basic with empty basicPassword", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "basic", basicPassword: "" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for device-token with profile source and non-empty token", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({
			type: "device-token",
			deviceTokenSource: "profile",
			deviceToken: "dev-tok",
		})
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for device-token with profile source and empty token", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({
			type: "device-token",
			deviceTokenSource: "profile",
			deviceToken: "",
		})
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for device-token with global source when token is set", () => {
		setDeviceToken("global-tok-123")
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "device-token", deviceTokenSource: "global" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for device-token with global source when token is empty", () => {
		setDeviceToken("")
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "device-token", deviceTokenSource: "global" })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns true for custom with non-empty customHeaders", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({
			type: "custom",
			customHeaders: { "X-Custom": "value" },
		})
		expect(hasRealCredentials(orchestrator, profile)).toBe(true)
	})

	it("returns false for custom with empty customHeaders", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "custom", customHeaders: {} })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns false for custom with whitespace-only header values", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({
			type: "custom",
			customHeaders: { Authorization: "   " },
		})
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})

	it("returns false for unknown auth type", () => {
		orchestrator = new CloudAgentOrchestrator(mockHost, mockService)
		const profile = createProfile({ type: "unknown" as any })
		expect(hasRealCredentials(orchestrator, profile)).toBe(false)
	})
})
