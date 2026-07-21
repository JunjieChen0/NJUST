import { describe, it, expect, vi, beforeEach } from "vitest"
import { sandboxAudit } from "../SandboxAudit"
import type { CommandExecutionRequest, CommandExecutionHandle } from "../CommandRunner"
import { logger } from "../../../shared/logger"

// Mock logger
vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("SandboxAudit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		sandboxAudit.clear()
	})

	// ─── Record Start ────────────────────────────────────────────────────

	describe("recordStart", () => {
		it("creates an audit record with required fields", () => {
			const request = createMockRequest("exec-001", "task-001", "local")
			const id = sandboxAudit.recordStart(request, "guarded-host")

			expect(id).toBe("exec-001")
			const records = sandboxAudit.getRecords()
			expect(records).toHaveLength(1)
			expect(records[0].executionId).toBe("exec-001")
			expect(records[0].taskId).toBe("task-001")
			expect(records[0].source).toBe("local")
			expect(records[0].backend).toBe("guarded-host")
			expect(records[0].startedAt).toBeDefined()
			expect(records[0].status).toBe("running")
		})

		it("records docker-specific fields", () => {
			const request = createMockRequest("exec-002", "task-002", "mcp")
			sandboxAudit.recordStart(request, "docker", {
				containerId: "abc123def456",
				imageDigest: "sha256:abc123",
				networkMode: "none",
				memoryMb: 512,
				cpuLimit: 1.0,
			})

			const records = sandboxAudit.getRecords()
			expect(records[0].containerId).toBe("abc123def456")
			expect(records[0].imageDigest).toBe("sha256:abc123")
			expect(records[0].networkMode).toBe("none")
			expect(records[0].memoryMb).toBe(512)
			expect(records[0].cpuLimit).toBe(1.0)
		})

		it("records approval and safety information", () => {
			const request = createMockRequest("exec-003", "task-003", "local")
			sandboxAudit.recordStart(request, "guarded-host", {
				approvalResult: "approved",
				commandSafety: "safe",
			})

			const records = sandboxAudit.getRecords()
			expect(records[0].approvalResult).toBe("approved")
			expect(records[0].commandSafety).toBe("safe")
		})

		it("persists resource scope and policy context in the start log", () => {
			const request = createMockRequest("exec-scope", "task-scope", "local")
			request.resourceScopeId = "task:task-scope:instance-1"

			sandboxAudit.recordStart(request, "docker", {
				requestedBackend: "docker",
				dockerStatus: "available",
			})

			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				resourceScopeId: "task:task-scope:instance-1",
				requestedBackend: "docker",
				dockerStatus: "available",
			})
			expect(logger.info).toHaveBeenCalledWith(
				"SandboxAudit",
				"execution_start",
				expect.objectContaining({
					resourceScopeId: "task:task-scope:instance-1",
					requestedBackend: "docker",
					dockerStatus: "available",
				}),
			)
		})
	})

	// ─── Record Complete ─────────────────────────────────────────────────

	describe("recordComplete", () => {
		it("updates existing record with completion info", () => {
			const request = createMockRequest("exec-010", "task-010", "local")
			sandboxAudit.recordStart(request, "guarded-host")

			const handle: CommandExecutionHandle = {
				executionId: "exec-010",
				backend: "guarded-host",
				exitCode: 0,
				output: "hello world",
				cancelled: false,
				timedOut: false,
			}
			sandboxAudit.recordComplete("exec-010", handle)

			const records = sandboxAudit.getRecords()
			expect(records[0].exitCode).toBe(0)
			expect(records[0].cancelled).toBe(false)
			expect(records[0].timedOut).toBe(false)
			expect(records[0].endedAt).toBeDefined()
			expect(records[0].durationMs).toBeGreaterThanOrEqual(0)
			expect(records[0].status).toBe("completed")
		})

		it("records timeout", () => {
			const request = createMockRequest("exec-011", "task-011", "cloud-agent")
			sandboxAudit.recordStart(request, "docker")

			const handle: CommandExecutionHandle = {
				executionId: "exec-011",
				backend: "docker",
				exitCode: undefined,
				output: "",
				cancelled: false,
				timedOut: true,
			}
			sandboxAudit.recordComplete("exec-011", handle)

			const records = sandboxAudit.getRecords()
			expect(records[0].timedOut).toBe(true)
		})

		it("merges Docker container, image, and resource metadata on completion", () => {
			const request = createMockRequest("exec-docker", "task-docker", "local")
			sandboxAudit.recordStart(request, "docker")

			sandboxAudit.recordComplete("exec-docker", {
				executionId: "exec-docker",
				backend: "docker",
				containerId: "container-123",
				imageDigest: "sha256:immutable",
				networkMode: "none",
				memoryMb: 512,
				cpuLimit: 1,
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			})

			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				containerId: "container-123",
				imageDigest: "sha256:immutable",
				networkMode: "none",
				memoryMb: 512,
				cpuLimit: 1,
			})
		})

		it("records cancellation", () => {
			const request = createMockRequest("exec-012", "task-012", "mcp")
			sandboxAudit.recordStart(request, "guarded-host")

			const handle: CommandExecutionHandle = {
				executionId: "exec-012",
				backend: "guarded-host",
				exitCode: undefined,
				output: "",
				cancelled: true,
				timedOut: false,
			}
			sandboxAudit.recordComplete("exec-012", handle)

			const records = sandboxAudit.getRecords()
			expect(records[0].cancelled).toBe(true)
		})

		it("records error information", () => {
			const request = createMockRequest("exec-013", "task-013", "local")
			sandboxAudit.recordStart(request, "guarded-host")

			const handle: CommandExecutionHandle = {
				executionId: "exec-013",
				backend: "guarded-host",
				exitCode: 1,
				output: "",
				cancelled: false,
				timedOut: false,
			}
			sandboxAudit.recordComplete("exec-013", handle, new Error("command failed"))

			const records = sandboxAudit.getRecords()
			expect(records[0].error).toBe("command failed")
		})

		it("warns when completing unknown execution", () => {
			const handle: CommandExecutionHandle = {
				executionId: "unknown-exec",
				backend: "guarded-host",
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			}
			// Should not throw
			expect(() => sandboxAudit.recordComplete("unknown-exec", handle)).not.toThrow()
		})
	})

	describe("recordDispatched", () => {
		it("marks an external terminal command without claiming it completed", () => {
			const request = createMockRequest("exec-014", "task-014", "user")
			sandboxAudit.recordStart(request, "guarded-host")
			sandboxAudit.recordDispatched("exec-014")

			const record = sandboxAudit.getRecords()[0]
			expect(record.status).toBe("dispatched")
			expect(record.dispatchedAt).toBeDefined()
			expect(record.endedAt).toBeUndefined()
		})
	})

	// ─── Record Denial ──────────────────────────────────────────────────

	describe("recordDenial", () => {
		it("records policy denial with reason and forces the denied approval result", () => {
			const request = createMockRequest("exec-020", "task-020", "local")
			request.audit = {
				approvalResult: "approved",
				commandSafety: "safe",
			}
			sandboxAudit.recordDenial(request, "docker", "unavailable", "Docker not available")

			const records = sandboxAudit.getRecords()
			expect(records).toHaveLength(1)
			expect(records[0].approvalResult).toBe("denied")
			expect(records[0].commandSafety).toBe("safe")
			expect(records[0].error).toBe("Docker not available")
			expect(records[0].status).toBe("completed")
		})
	})

	// ─── Query Functions ─────────────────────────────────────────────────

	describe("query functions", () => {
		it("getRecords returns records in reverse chronological order", () => {
			sandboxAudit.recordStart(createMockRequest("e1", "t1", "local"), "guarded-host")
			sandboxAudit.recordStart(createMockRequest("e2", "t2", "mcp"), "guarded-host")
			sandboxAudit.recordStart(createMockRequest("e3", "t3", "cloud-agent"), "docker")

			const records = sandboxAudit.getRecords()
			expect(records).toHaveLength(3)
			expect(records[0].executionId).toBe("e3") // Most recent first
			expect(records[2].executionId).toBe("e1") // Oldest last
		})

		it("getRecordsForTask filters by task ID", () => {
			sandboxAudit.recordStart(createMockRequest("e1", "task-A", "local"), "guarded-host")
			sandboxAudit.recordStart(createMockRequest("e2", "task-B", "local"), "guarded-host")
			sandboxAudit.recordStart(createMockRequest("e3", "task-A", "local"), "guarded-host")

			const records = sandboxAudit.getRecordsForTask("task-A")
			expect(records).toHaveLength(2)
			expect(records.every((r) => r.taskId === "task-A")).toBe(true)
		})

		it("clear removes all records", () => {
			sandboxAudit.recordStart(createMockRequest("e1", "t1", "local"), "guarded-host")
			sandboxAudit.recordStart(createMockRequest("e2", "t2", "local"), "guarded-host")

			expect(sandboxAudit.getRecords()).toHaveLength(2)
			sandboxAudit.clear()
			expect(sandboxAudit.getRecords()).toHaveLength(0)
		})
	})

	// ─── Buffer Management ──────────────────────────────────────────────

	describe("ring buffer", () => {
		it("trims old records when buffer exceeds max size", () => {
			// MAX_BUFFER_SIZE is 500
			for (let i = 0; i < 510; i++) {
				sandboxAudit.recordStart(createMockRequest(`exec-${i}`, `task-${i}`, "local"), "guarded-host")
			}

			const records = sandboxAudit.getRecords()
			expect(records.length).toBeLessThanOrEqual(500)
		})
	})

	// ─── Sensitive Data Protection ──────────────────────────────────────

	describe("sensitive data protection", () => {
		it("does not store API keys in records", () => {
			const request = createMockRequest("exec-sec", "task-sec", "local")
			sandboxAudit.recordStart(request, "guarded-host")

			const records = sandboxAudit.getRecords()
			const serialized = JSON.stringify(records)
			expect(serialized).not.toContain("API_KEY")
			expect(serialized).not.toContain("SECRET")
			expect(serialized).not.toContain("PASSWORD")
		})

		it("does not store full environment variables", () => {
			const request = createMockRequest("exec-env", "task-env", "local")
			request.environment = { MY_SECRET: "s3cret" }
			sandboxAudit.recordStart(request, "guarded-host")

			const records = sandboxAudit.getRecords()
			const serialized = JSON.stringify(records)
			expect(serialized).not.toContain("s3cret")
		})
	})
})

// ─── Helper ──────────────────────────────────────────────────────────────────

function createMockRequest(
	executionId: string,
	taskId: string,
	source: CommandExecutionRequest["source"],
): CommandExecutionRequest {
	return {
		executionId,
		taskId,
		command: "echo test",
		workspacePath: "/home/user/project",
		cwd: "/home/user/project",
		timeoutMs: 30_000,
		source,
		onOutput: vi.fn(),
	}
}
