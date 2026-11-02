// End-to-end over the real client: raw HTTP responses -> RestProtocolAdapter ->
// CloudAgentClient -> CloudAgentOrchestrator. The orchestrator spec mocks the
// client, so it cannot catch a field dropped on the way (e.g. server_revision).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { CloudAgentOrchestrator, type ICloudAgentHost } from "../CloudAgentOrchestrator"
import { executeDeferredToolCall } from "../../../services/cloud-agent/executeDeferredToolCall"
import { asMock } from "../../../__tests__/helpers/asMock"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

vi.mock("../../../services/cloud-agent/ProfileStorageService", () => ({
	getProfileStorageService: vi.fn(function () {
		return {
			getActiveProfile: vi.fn(function () {
				return {
					id: "test-profile",
					name: "Test Profile",
					protocolType: "rest",
					serverUrl: "http://127.0.0.1:4000",
					auth: { type: "api-key", apiKey: "test-api-key", deviceTokenSource: "global" },
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}
			}),
		}
	}),
}))

vi.mock("../../../services/cloud-agent/executeDeferredToolCall", () => ({
	executeDeferredToolCall: vi.fn(),
}))

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const CONFIG: Record<string, unknown> = {
	"cloudAgent.serverUrl": "http://127.0.0.1:4000",
	"cloudAgent.apiKey": "test-api-key",
	"cloudAgent.requestTimeoutMs": 0,
	"cloudAgent.applyRemoteWorkspaceOps": true,
	"cloudAgent.confirmRemoteWorkspaceOps": false,
	"cloudAgent.deferredProtocol": true,
	"cloudAgent.compileLoop.enabled": false,
	allowedCommands: [],
	deniedCommands: [],
}

function createHost(): ICloudAgentHost {
	return {
		taskId: "test-task-id",
		instanceId: "test-instance-id",
		cwd: "/test/workspace",
		abort: false,
		rooIgnoreController: undefined,
		rooProtectedController: undefined,
		say: vi.fn().mockResolvedValue(undefined),
		ask: asMock<ICloudAgentHost["ask"]>(
			vi.fn(async (type: string) => ({
				response: type === "api_req_failed" ? "noButtonClicked" : "yesButtonClicked",
			})),
		),
		emit: vi.fn().mockReturnValue(true),
		setCurrentRequestAbortController: vi.fn(),
		markCompleted: vi.fn(),
	}
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe("CloudAgentOrchestrator over HTTP", () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			asMock<vscode.WorkspaceConfiguration>({
				get: vi.fn((key: string, defaultValue?: unknown) => CONFIG[key] ?? defaultValue),
			}),
		)
		vi.mocked(executeDeferredToolCall).mockImplementation(async (_cwd, call) => ({
			call_id: call.call_id,
			content: "ok",
			is_error: false,
		}))
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it("stops before running the next round's tools when server_revision changes", async () => {
		const tool = (callId: string) => ({ call_id: callId, tool: "read_file", arguments: { path: "a.ts" } })
		globalThis.fetch = vi.fn<typeof fetch>(async (input) => {
			const url = String(input)
			if (url.endsWith("/deferred/start")) {
				return json({
					run_id: "run-1",
					status: "pending",
					server_revision: "rev-1",
					pending_tools: [tool("c1")],
				})
			}
			if (url.endsWith("/deferred/resume")) {
				return json({
					run_id: "run-1",
					status: "pending",
					server_revision: "rev-2",
					pending_tools: [tool("c2")],
				})
			}
			return json({})
		})
		const host = createHost()

		await new CloudAgentOrchestrator(host).run("hello")

		expect(vi.mocked(executeDeferredToolCall).mock.calls.map(([, call]) => call.call_id)).toEqual(["c1"])
		expect(host.say).toHaveBeenCalledWith(
			"error",
			expect.stringContaining("errors.cloud_agent.server_revision_changed"),
		)
		expect(host.markCompleted).not.toHaveBeenCalled()
	})
})
