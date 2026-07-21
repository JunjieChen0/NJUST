import { afterEach, describe, expect, it, vi } from "vitest"

import { GuardedHostRunner } from "../GuardedHostRunner"
import type { CommandExecutionRequest } from "../CommandRunner"

vi.mock("../../../integrations/terminal/BaseTerminal", () => ({
	BaseTerminal: {
		getExecaShellPath: vi.fn().mockReturnValue(undefined),
	},
}))

vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("GuardedHostRunner real Execa environment isolation", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("does not expose host or request secrets but preserves explicitly allowed env", async () => {
		vi.stubEnv("NJUST_RUNNER_SENTINEL_TOKEN", "host-secret-sentinel")
		const runner = new GuardedHostRunner()
		const environment = {
			REQUEST_API_KEY: "req-sentinel",
			GUARDED_SAFE_VALUE: "allowed-value",
		}

		const hostSecret = await runner.run(
			createRequest("host-secret", "node -p process.env.NJUST_RUNNER_SENTINEL_TOKEN", environment),
		)
		const requestSecret = await runner.run(
			createRequest("request-secret", "node -p process.env.REQUEST_API_KEY", environment),
		)
		const allowedValue = await runner.run(
			createRequest("allowed", "node -p process.env.GUARDED_SAFE_VALUE", environment),
		)

		expect(hostSecret.stdout?.trim()).toBe("undefined")
		expect(requestSecret.stdout?.trim()).toBe("undefined")
		expect(allowedValue.stdout?.trim()).toBe("allowed-value")
	})
})

function createRequest(
	executionId: string,
	command: string,
	environment: Record<string, string>,
): CommandExecutionRequest {
	return {
		executionId,
		taskId: "integration-task",
		command,
		workspacePath: process.cwd(),
		timeoutMs: 15_000,
		environment,
		source: "local",
		onOutput: vi.fn(),
	}
}
