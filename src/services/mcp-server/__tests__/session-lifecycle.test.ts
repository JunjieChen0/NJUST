import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as http from "http"
import nock from "nock"

import { RooToolsMcpServer } from "../RooToolsMcpServer"
import { SandboxExecutionService } from "../../sandbox"

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SESSIONS = 20
const MAX_SESSIONS_PER_IP = 5
const IDLE_TTL_MS = 30 * 60 * 1000
const ABSOLUTE_TTL_MS = 4 * 60 * 60 * 1000

// ─── Helpers ────────────────────────────────────────────────────────────────

const INIT_BODY = JSON.stringify({
	jsonrpc: "2.0",
	method: "initialize",
	id: 1,
	params: {
		protocolVersion: "2025-03-26",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0" },
	},
})

interface FakeEntry {
	transport: { close: () => Promise<void>; sessionId?: string }
	metadata: { sessionId: string; createdAt: number; lastActivityAt: number; remoteIp: string }
	requestsInFlight: number
	closing: boolean
	graceDeadline: number | null
}

function makeEntry(remoteIp: string, createdAt: number, lastActivityAt?: number): FakeEntry {
	return {
		transport: { close: vi.fn(() => Promise.resolve()), sessionId: undefined },
		metadata: {
			sessionId: `s-${Math.random().toString(36).slice(2)}`,
			createdAt,
			lastActivityAt: lastActivityAt ?? createdAt,
			remoteIp,
		},
		requestsInFlight: 0,
		closing: false,
		graceDeadline: null,
	}
}

function postJson(port: number, body: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method: "POST",
				path: "/mcp",
				headers: { "Content-Type": "application/json" },
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on("data", (c: Buffer) => chunks.push(c))
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
			},
		)
		req.on("error", reject)
		req.write(body)
		req.end()
	})
}

async function flushMicrotasks(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0))
}

// ─── Accessor helpers (avoid direct assignment on private fields) ────────────

function getTransports(server: RooToolsMcpServer): Map<string, FakeEntry> {
	return (server as unknown as { transports: Map<string, FakeEntry> }).transports
}

function getPendingSlots(server: RooToolsMcpServer): number {
	return (server as unknown as { pendingSlots: number }).pendingSlots
}

function getPendingSandboxCleanupSessions(server: RooToolsMcpServer): Set<string> {
	return (server as unknown as { pendingSandboxCleanupSessions: Set<string> }).pendingSandboxCleanupSessions
}

function setPendingSlots(server: RooToolsMcpServer, value: number): void {
	Object.defineProperty(server, "pendingSlots", { value, writable: true, configurable: true })
}

function setPendingSlotsByIp(server: RooToolsMcpServer, value: Map<string, number>): void {
	Object.defineProperty(server, "pendingSlotsByIp", { value, writable: true, configurable: true })
}

function reclaim(server: RooToolsMcpServer): void {
	;(server as unknown as { reclaimExpiredSessions: () => void }).reclaimExpiredSessions()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MCP Session Lifecycle", () => {
	let server: RooToolsMcpServer
	let port: number

	beforeEach(async () => {
		nock.enableNetConnect("127.0.0.1")
		server = new RooToolsMcpServer({ workspacePath: process.cwd(), port: 0, bindAddress: "127.0.0.1" })
		await server.start()
		const addr = (server as unknown as { httpServer: http.Server }).httpServer?.address()
		port = typeof addr === "object" && addr ? addr.port : 0
	})

	afterEach(async () => {
		await server.stop()
		nock.cleanAll()
		vi.useRealTimers()
	})

	it("rejects initialize when global session limit is reached", async () => {
		const transports = getTransports(server)
		const now = Date.now()
		for (let i = 0; i < MAX_SESSIONS; i++) {
			transports.set(`s${i}`, makeEntry("127.0.0.1", now))
		}
		const resp = await postJson(port, INIT_BODY)
		expect(resp.status).toBe(503)
		expect(JSON.parse(resp.body).error.message).toContain("Maximum session count")
	})

	it("rejects initialize when per-IP session limit is reached", async () => {
		const transports = getTransports(server)
		const now = Date.now()
		const testIp = "10.10.10.10"
		for (let i = 0; i < MAX_SESSIONS_PER_IP; i++) {
			transports.set(`ip${i}`, makeEntry(testIp, now))
		}
		Object.defineProperty(server, "getRemoteIp", {
			value: () => testIp,
			writable: true,
			configurable: true,
		})
		const resp = await postJson(port, INIT_BODY)
		expect(resp.status).toBe(429)
		expect(JSON.parse(resp.body).error.message).toContain("Too many sessions")
	})

	it("reclaims idle sessions after IDLE_TTL_MS and deletes them", async () => {
		const transports = getTransports(server)
		const past = Date.now() - IDLE_TTL_MS - 60_000
		const entry = makeEntry("10.0.0.1", past, past)
		transports.set("idle1", entry)

		reclaim(server)

		expect(entry.transport.close).toHaveBeenCalled()
		await flushMicrotasks()
		expect(transports.has("idle1")).toBe(false)
	})

	it("reclaims sessions exceeding ABSOLUTE_TTL_MS", async () => {
		const transports = getTransports(server)
		const created = Date.now() - ABSOLUTE_TTL_MS - 60_000
		const entry = makeEntry("10.0.0.2", created, Date.now())
		transports.set("abs1", entry)

		reclaim(server)

		expect(entry.transport.close).toHaveBeenCalled()
		await flushMicrotasks()
		expect(transports.has("abs1")).toBe(false)
	})

	it("grants grace period for in-flight requests during TTL expiry", () => {
		const transports = getTransports(server)
		const past = Date.now() - IDLE_TTL_MS - 60_000
		const entry = makeEntry("10.0.0.3", past, past)
		entry.requestsInFlight = 1
		transports.set("grace1", entry)

		reclaim(server)

		const remaining = transports.get("grace1")
		expect(remaining).toBeDefined()
		expect(remaining!.closing).toBe(true)
		expect(remaining!.graceDeadline).toBeGreaterThan(0)
		expect(entry.transport.close).not.toHaveBeenCalled()
	})

	it("force-deletes sessions after grace period expires", () => {
		const transports = getTransports(server)
		const entry: FakeEntry = {
			transport: { close: vi.fn(() => Promise.resolve()), sessionId: undefined },
			metadata: {
				sessionId: "grace-exp",
				createdAt: Date.now() - 1000,
				lastActivityAt: Date.now() - 1000,
				remoteIp: "10.0.0.4",
			},
			requestsInFlight: 0,
			closing: true,
			graceDeadline: Date.now() - 1000,
		}
		transports.set("grace-exp", entry)

		reclaim(server)

		expect(transports.has("grace-exp")).toBe(false)
	})

	it("pendingSlots counts toward global limit", async () => {
		const transports = getTransports(server)
		const now = Date.now()
		for (let i = 0; i < MAX_SESSIONS - 1; i++) {
			transports.set(`slot${i}`, makeEntry(`10.0.0.${i}`, now))
		}

		setPendingSlots(server, 1)
		const ipMap = new Map<string, number>()
		ipMap.set("127.0.0.1", 1)
		setPendingSlotsByIp(server, ipMap)

		expect(getPendingSlots(server)).toBe(1)
		const resp = await postJson(port, INIT_BODY)
		expect(resp.status).toBe(503)
	})

	it("pendingSlotsByIp counts toward per-IP limit", async () => {
		const transports = getTransports(server)
		const now = Date.now()
		const testIp = "10.20.30.40"
		for (let i = 0; i < MAX_SESSIONS_PER_IP - 1; i++) {
			transports.set(`ipslot${i}`, makeEntry(testIp, now))
		}

		const ipMap = new Map<string, number>()
		ipMap.set(testIp, 1)
		setPendingSlotsByIp(server, ipMap)
		Object.defineProperty(server, "getRemoteIp", {
			value: () => testIp,
			writable: true,
			configurable: true,
		})

		const resp = await postJson(port, INIT_BODY)
		expect(resp.status).toBe(429)
	})

	it("rejects new sessions after shutdown admission closes", async () => {
		Object.defineProperty(server, "stopping", { value: true, writable: true, configurable: true })

		const resp = await postJson(port, INIT_BODY)

		expect(resp.status).toBe(503)
		expect(getTransports(server).size).toBe(0)
		expect(getPendingSlots(server)).toBe(0)
		Object.defineProperty(server, "stopping", { value: false, writable: true, configurable: true })
	})

	it("waits for session sandbox cleanup before stop resolves", async () => {
		let resolveCleanup!: () => void
		const cleanup = new Promise<void>((resolve) => {
			resolveCleanup = resolve
		})
		const disposeTask = vi
			.spyOn(SandboxExecutionService.getInstance(), "disposeTask")
			.mockImplementation(() => cleanup)
		getTransports(server).set("stop-session", makeEntry("127.0.0.1", Date.now()))

		let stopped = false
		const stopPromise = server.stop().then(() => {
			stopped = true
		})
		await flushMicrotasks()

		expect(disposeTask).toHaveBeenCalledWith("mcp:stop-session")
		expect(stopped).toBe(false)

		resolveCleanup()
		await stopPromise
		expect(stopped).toBe(true)
		disposeTask.mockRestore()
	})

	it("does not clean the same session twice when transport close triggers cleanup", async () => {
		const disposeTask = vi.spyOn(SandboxExecutionService.getInstance(), "disposeTask").mockResolvedValue(undefined)
		const entry = makeEntry("127.0.0.1", Date.now())
		entry.transport.close = vi.fn(async () => {
			;(server as unknown as { cleanupSandboxSession: (sessionId: string) => void }).cleanupSandboxSession(
				"dedupe-session",
			)
			await flushMicrotasks()
		})
		getTransports(server).set("dedupe-session", entry)

		await server.stop()

		expect(disposeTask).toHaveBeenCalledTimes(1)
		expect(disposeTask).toHaveBeenCalledWith("mcp:dedupe-session")
		disposeTask.mockRestore()
	})

	it("waits for cleanup that started after a session already closed", async () => {
		let resolveCleanup!: () => void
		const cleanup = new Promise<void>((resolve) => {
			resolveCleanup = resolve
		})
		const disposeTask = vi
			.spyOn(SandboxExecutionService.getInstance(), "disposeTask")
			.mockImplementation(() => cleanup)
		;(server as unknown as { cleanupSandboxSession: (sessionId: string) => Promise<void> })
			.cleanupSandboxSession("closed-session")
			.catch(() => {})

		let stopped = false
		const stopping = server.stop().then(() => {
			stopped = true
		})
		await flushMicrotasks()
		expect(stopped).toBe(false)

		resolveCleanup()
		await stopping
		expect(stopped).toBe(true)
		disposeTask.mockRestore()
	})

	it("retries a failed background session cleanup during stop", async () => {
		const disposeTask = vi
			.spyOn(SandboxExecutionService.getInstance(), "disposeTask")
			.mockRejectedValueOnce(new Error("transient cleanup failure"))
			.mockResolvedValueOnce(undefined)
		;(
			server as unknown as { scheduleSandboxSessionCleanup: (sessionId: string) => void }
		).scheduleSandboxSessionCleanup("closed-failed-session")
		await flushMicrotasks()

		expect(disposeTask).toHaveBeenCalledOnce()
		await expect(server.stop()).resolves.toBeUndefined()
		expect(disposeTask).toHaveBeenCalledTimes(2)
		expect(disposeTask).toHaveBeenLastCalledWith("mcp:closed-failed-session")
		disposeTask.mockRestore()
	})

	it("retries a transient background cleanup failure while the server is running", async () => {
		vi.useFakeTimers()
		const disposeTask = vi
			.spyOn(SandboxExecutionService.getInstance(), "disposeTask")
			.mockRejectedValueOnce(new Error("transient cleanup failure"))
			.mockResolvedValueOnce(undefined)
		;(
			server as unknown as { scheduleSandboxSessionCleanup: (sessionId: string) => void }
		).scheduleSandboxSessionCleanup("background-retry")

		await vi.advanceTimersByTimeAsync(0)
		expect(disposeTask).toHaveBeenCalledOnce()
		expect(getPendingSandboxCleanupSessions(server).has("background-retry")).toBe(true)

		await vi.advanceTimersByTimeAsync(1_000)
		expect(disposeTask).toHaveBeenCalledTimes(2)
		expect(getPendingSandboxCleanupSessions(server).has("background-retry")).toBe(false)
		vi.useRealTimers()
		disposeTask.mockRestore()
	})

	it("propagates sandbox cleanup failures from stop", async () => {
		const disposeTask = vi
			.spyOn(SandboxExecutionService.getInstance(), "disposeTask")
			.mockRejectedValue(new Error("container cleanup failed"))
		getTransports(server).set("failed-cleanup", makeEntry("127.0.0.1", Date.now()))

		await expect(server.stop()).rejects.toThrow("container cleanup failed")
		expect(disposeTask).toHaveBeenCalledTimes(2)

		disposeTask.mockRestore()
	})

	it("tracks session metrics: rejected on global limit", async () => {
		const transports = getTransports(server)
		const now = Date.now()
		for (let i = 0; i < MAX_SESSIONS; i++) {
			transports.set(`m${i}`, makeEntry("127.0.0.1", now))
		}

		const before = server.getSessionMetrics()
		const resp = await postJson(port, INIT_BODY)
		expect(resp.status).toBe(503)
		const after = server.getSessionMetrics()
		expect(after.totalRejected).toBe(before.totalRejected + 1)
	})

	it("tracks session metrics: expired on reclaim", async () => {
		const transports = getTransports(server)
		const past = Date.now() - IDLE_TTL_MS - 60_000
		const entry = makeEntry("10.0.0.99", past, past)
		transports.set("metric-exp", entry)

		const before = server.getSessionMetrics()
		reclaim(server)
		await flushMicrotasks()
		const after = server.getSessionMetrics()
		expect(after.totalExpired).toBe(before.totalExpired + 1)
	})
})
