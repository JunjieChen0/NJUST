import * as http from "http"
import crypto, { randomUUID } from "crypto"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
	execReadFile,
	execWriteFile,
	execListFiles,
	execSearchFiles,
	execCommand,
	execApplyDiff,
} from "./tool-executors"
import { getErrorMessage } from "../../shared/error-utils"
import { logSecurityEvent } from "../../shared/security-audit"
import { logger } from "../../shared/logger"
import { RooProtectedController } from "../../core/protect/RooProtectedController"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import type { IPathValidator, IWriteProtector } from "../cloud-agent/interfaces/IPathAccessController"
import { createPerRequestResourceLimits } from "./ResourceLimitsService"

// ── Token-bucket rate limiter (no external deps) ──────────────────────────

class RateLimiter {
	private tokens: number
	private lastRefill: number

	constructor(
		private maxTokens: number,
		private refillRate: number,
	) {
		this.tokens = maxTokens
		this.lastRefill = Date.now()
	}

	tryConsume(): boolean {
		const now = Date.now()
		const elapsed = (now - this.lastRefill) / 1000
		this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
		this.lastRefill = now
		if (this.tokens >= 1) {
			this.tokens--
			return true
		}
		return false
	}
}

/**
 * Per-IP rate limiter with automatic entry expiration.
 * Each IP gets an independent token bucket. Stale entries (no activity
 * for {@link IP_ENTRY_TTL_MS}) are pruned periodically to prevent
 * unbounded memory growth from scanning attacks.
 */
class PerIpRateLimiter {
	private buckets = new Map<string, { limiter: RateLimiter; lastSeen: number }>()
	private cleanupTimer: ReturnType<typeof setInterval> | null = null

	constructor(
		private maxTokens: number,
		private refillRate: number,
	) {
		// Prune stale entries every 10 minutes
		this.cleanupTimer = setInterval(() => this.pruneStale(), 10 * 60 * 1000)
		// Allow the timer to not prevent process exit
		if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
			this.cleanupTimer.unref()
		}
	}

	tryConsume(ip: string): boolean {
		let entry = this.buckets.get(ip)
		if (!entry) {
			entry = { limiter: new RateLimiter(this.maxTokens, this.refillRate), lastSeen: Date.now() }
			this.buckets.set(ip, entry)
		}
		entry.lastSeen = Date.now()
		return entry.limiter.tryConsume()
	}

	private pruneStale(): void {
		const now = Date.now()
		for (const [ip, entry] of this.buckets) {
			if (now - entry.lastSeen > IP_ENTRY_TTL_MS) {
				this.buckets.delete(ip)
			}
		}
	}

	dispose(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer)
			this.cleanupTimer = null
		}
		this.buckets.clear()
	}
}

const IP_ENTRY_TTL_MS = 30 * 60 * 1000 // 30 minutes — align with session idle TTL

interface RooToolsMcpServerOptions {
	workspacePath: string
	port: number
	bindAddress: string
	authToken?: string
	allowedCommands?: string[]
	deniedCommands?: string[]
	pathValidator?: IPathValidator
	protectedController?: IWriteProtector
}

interface SessionMetadata {
	sessionId: string
	createdAt: number
	lastActivityAt: number
	remoteIp: string
}

interface SessionEntry {
	transport: StreamableHTTPServerTransport
	metadata: SessionMetadata
	requestsInFlight: number
	closing: boolean
	graceDeadline: number | null
}

const MAX_SESSIONS = 20
const MAX_SESSIONS_PER_IP = 5
const IDLE_TTL_MS = 30 * 60 * 1000
const ABSOLUTE_TTL_MS = 4 * 60 * 60 * 1000
const GRACE_PERIOD_MS = 30 * 1000 // 30 seconds grace for in-flight requests
const RECLAMATION_INTERVAL_MS = 5 * 60 * 1000
const SANDBOX_CLEANUP_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const

export class RooToolsMcpServer {
	private httpServer: http.Server | null = null
	private transports = new Map<string, SessionEntry>()
	private options: RooToolsMcpServerOptions
	private pathValidator: IPathValidator
	private protectedController: IWriteProtector
	private ownedPathValidator: RooIgnoreController | undefined
	private ownedProtectedController: RooProtectedController | undefined
	private pathValidatorInitialized = false
	private readonly globalLimiter = new RateLimiter(60, 10)
	private readonly perIpLimiter = new PerIpRateLimiter(30, 5)
	private reclamationTimer: ReturnType<typeof setInterval> | null = null
	private stopping = false
	/** Atomic slot reservation: counts initialize requests in-flight before transport is registered */
	private pendingSlots = 0
	private pendingSlotsByIp = new Map<string, number>()

	// ── Session metrics ──────────────────────────────────────────────────
	private metricsSessionsCreated = 0
	private metricsSessionsRejected = 0
	private metricsSessionsExpired = 0

	// ── Sandbox cleanup tracking (idempotent per session) ─────────────────
	private readonly sandboxCleanupFlights = new Map<string, Promise<void>>()
	private readonly pendingSandboxCleanupSessions = new Set<string>()
	private readonly sandboxCleanupRetryAttempts = new Map<string, number>()
	private readonly sandboxCleanupRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()

	constructor(options: RooToolsMcpServerOptions) {
		this.options = options
		if (options.pathValidator) {
			this.pathValidator = options.pathValidator
		} else {
			this.ownedPathValidator = new RooIgnoreController(options.workspacePath)
			this.pathValidator = this.ownedPathValidator
		}
		if (options.protectedController) {
			this.protectedController = options.protectedController
		} else {
			this.ownedProtectedController = new RooProtectedController(options.workspacePath)
			this.protectedController = this.ownedProtectedController
		}
	}

	async updateWorkspacePath(newPath: string): Promise<void> {
		if (newPath === this.options.workspacePath) return

		let nextPathValidator: RooIgnoreController | undefined
		try {
			if (this.ownedPathValidator) {
				nextPathValidator = new RooIgnoreController(newPath)
				await nextPathValidator.initialize()
			}
		} catch (error) {
			nextPathValidator?.dispose()
			throw error
		}

		const previousPathValidator = this.ownedPathValidator
		const nextProtectedController = this.ownedProtectedController ? new RooProtectedController(newPath) : undefined

		this.options.workspacePath = newPath
		if (nextPathValidator) {
			this.ownedPathValidator = nextPathValidator
			this.pathValidator = nextPathValidator
		}
		if (nextProtectedController) {
			this.ownedProtectedController = nextProtectedController
			this.protectedController = nextProtectedController
		}
		previousPathValidator?.dispose()
		this.pathValidatorInitialized = Boolean(nextPathValidator)
	}

	private async initializeAccessControllers(): Promise<void> {
		if (this.ownedPathValidator && !this.pathValidatorInitialized) {
			await this.ownedPathValidator.initialize()
			this.pathValidatorInitialized = true
		}
	}

	private accessDenied(filePath: string): { content: [{ type: "text"; text: string }]; isError: true } {
		return {
			content: [{ type: "text" as const, text: `Access denied by .rooignore: ${filePath}` }],
			isError: true,
		}
	}

	private writeProtected(filePath: string): { content: [{ type: "text"; text: string }]; isError: true } {
		return {
			content: [{ type: "text" as const, text: `Write protected: ${filePath}` }],
			isError: true,
		}
	}

	/** Return current session metrics for monitoring. */
	getSessionMetrics(): {
		active: number
		pending: number
		totalCreated: number
		totalRejected: number
		totalExpired: number
	} {
		return {
			active: this.transports.size,
			pending: this.pendingSlots,
			totalCreated: this.metricsSessionsCreated,
			totalRejected: this.metricsSessionsRejected,
			totalExpired: this.metricsSessionsExpired,
		}
	}

	private get cwd(): string {
		return this.options.workspacePath
	}

	private createMcpServer(getSessionId: () => string | undefined): McpServer {
		const server = new McpServer({ name: "njust-ai-tools", version: "1.0.0" }, { capabilities: { tools: {} } })

		server.tool(
			"read_file",
			"Read the contents of a file within the workspace. Returns numbered lines.",
			{
				path: z.string().describe("Relative path to the file within the workspace"),
				start_line: z.number().optional().describe("Starting line number (1-based)"),
				end_line: z.number().optional().describe("Ending line number (1-based, inclusive)"),
			},
			async (params) => {
				const resourceLimits = createPerRequestResourceLimits()
				try {
					if (!this.pathValidator.validateAccess(params.path)) {
						return this.accessDenied(params.path)
					}
					const result = await execReadFile(this.cwd, params, resourceLimits)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				} finally {
					resourceLimits.dispose()
				}
			},
		)

		server.tool(
			"write_to_file",
			"Write content to a file within the workspace. Creates parent directories if needed.",
			{
				path: z.string().describe("Relative path to the file within the workspace"),
				content: z.string().describe("The full content to write to the file"),
			},
			async (params) => {
				const resourceLimits = createPerRequestResourceLimits()
				try {
					if (!this.pathValidator.validateAccess(params.path)) {
						return this.accessDenied(params.path)
					}
					if (await this.protectedController.isWriteProtected(params.path)) {
						return this.writeProtected(params.path)
					}
					const result = await execWriteFile(this.cwd, params, this.protectedController, resourceLimits)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				} finally {
					resourceLimits.dispose()
				}
			},
		)

		server.tool(
			"list_files",
			"List files and directories within a directory in the workspace.",
			{
				path: z.string().describe("Relative path to the directory within the workspace"),
				recursive: z.boolean().optional().describe("Whether to list files recursively (default: false)"),
			},
			async (params) => {
				const resourceLimits = createPerRequestResourceLimits()
				try {
					if (!this.pathValidator.validateAccess(params.path)) {
						return this.accessDenied(params.path)
					}
					const result = await execListFiles(this.cwd, params, this.pathValidator, resourceLimits)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				} finally {
					resourceLimits.dispose()
				}
			},
		)

		server.tool(
			"search_files",
			"Search for a regex pattern across files in a directory within the workspace.",
			{
				path: z.string().describe("Relative path to the directory to search in"),
				regex: z.string().describe("Regular expression pattern to search for (Rust regex syntax)"),
				file_pattern: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts')"),
			},
			async (params) => {
				const resourceLimits = createPerRequestResourceLimits()
				try {
					if (!this.pathValidator.validateAccess(params.path)) {
						return this.accessDenied(params.path)
					}
					const result = await execSearchFiles(this.cwd, params, this.pathValidator, resourceLimits)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				} finally {
					resourceLimits.dispose()
				}
			},
		)

		server.tool(
			"execute_command",
			"Execute a shell command in the workspace.",
			{
				command: z.string().describe("The shell command to execute"),
				cwd: z.string().optional().describe("Working directory for the command (relative to workspace)"),
				timeout: z.number().optional().describe("Timeout in seconds (default: 30)"),
			},
			async (params) => {
				const sessionId = getSessionId()
				if (!sessionId) {
					return {
						content: [{ type: "text" as const, text: "Error: MCP session not initialized" }],
						isError: true,
					}
				}
				try {
					const blockedPath = this.pathValidator.validateCommand?.(params.command)
					if (blockedPath) {
						return this.accessDenied(blockedPath)
					}
					const result = await execCommand(
						this.cwd,
						params,
						{
							source: "mcp",
							taskId: `mcp:${sessionId}`,
							resourceScopeId: `mcp:${sessionId}`,
						},
						this.options.allowedCommands,
						this.options.deniedCommands,
					)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				}
			},
		)

		server.tool(
			"apply_diff",
			"Apply a search/replace diff to a file. Uses <<<<<<< SEARCH / ======= / >>>>>>> REPLACE format.",
			{
				path: z.string().describe("Relative path to the file to modify"),
				diff: z.string().describe("The diff content using SEARCH/REPLACE block format"),
			},
			async (params) => {
				const resourceLimits = createPerRequestResourceLimits()
				try {
					if (!this.pathValidator.validateAccess(params.path)) {
						return this.accessDenied(params.path)
					}
					if (await this.protectedController.isWriteProtected(params.path)) {
						return this.writeProtected(params.path)
					}
					const result = await execApplyDiff(this.cwd, params, this.protectedController, resourceLimits)
					return { content: [{ type: "text" as const, text: result }] }
				} catch (e: unknown) {
					return { content: [{ type: "text" as const, text: `Error: ${getErrorMessage(e)}` }], isError: true }
				} finally {
					resourceLimits.dispose()
				}
			},
		)

		return server
	}

	private isLocalOnly(): boolean {
		const addr = this.options.bindAddress
		return addr === "127.0.0.1" || addr === "localhost" || addr === "::1"
	}

	async start(): Promise<void> {
		const { port, bindAddress, authToken } = this.options
		if (!this.isLocalOnly() && !authToken) {
			throw new Error(
				"Security: authToken is required when binding to a non-localhost address. " +
					"Set njust-ai.mcpServer.authToken in your settings before exposing the MCP server to the network.",
			)
		}

		// Rebuild owned controllers if they were disposed during a previous stop().
		if (!this.ownedPathValidator && !this.options.pathValidator) {
			this.ownedPathValidator = new RooIgnoreController(this.options.workspacePath)
			this.pathValidator = this.ownedPathValidator
		}
		if (!this.ownedProtectedController && !this.options.protectedController) {
			this.ownedProtectedController = new RooProtectedController(this.options.workspacePath)
			this.protectedController = this.ownedProtectedController
		}

		await this.initializeAccessControllers()
		this.stopping = false
		for (const sessionId of this.pendingSandboxCleanupSessions) {
			this.sandboxCleanupRetryAttempts.delete(sessionId)
			this.scheduleSandboxCleanupRetry(sessionId)
		}

		this.httpServer = http.createServer(async (req, res) => {
			const allowedOrigin = this.isLocalOnly() ? "null" : (req.headers.origin ?? "null")
			res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization")
			res.setHeader("Access-Control-Expose-Headers", "mcp-session-id")

			if (this.stopping) {
				res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" })
				res.end(JSON.stringify({ error: "MCP server is stopping" }))
				return
			}

			if (req.method === "OPTIONS") {
				res.writeHead(204)
				res.end()
				return
			}

			if (authToken && !this.verifyAuth(req, authToken)) {
				logSecurityEvent({
					action: "mcp.session.auth",
					resource: this.getRemoteIp(req),
					result: "denied",
					reason: "invalid_auth_token",
				})
				res.writeHead(401, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Unauthorized" }))
				return
			}

			if (!this.globalLimiter.tryConsume()) {
				res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" })
				res.end(JSON.stringify({ error: "Rate limit exceeded. Try again later." }))
				return
			}

			// Per-IP rate limit: prevent single IP from monopolizing global budget
			const clientIp = this.getRemoteIp(req)
			if (!this.perIpLimiter.tryConsume(clientIp)) {
				logSecurityEvent({
					action: "mcp.rate_limit.per_ip",
					resource: clientIp,
					result: "denied",
					reason: "per_ip_rate_limit",
				})
				res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" })
				res.end(JSON.stringify({ error: "Per-IP rate limit exceeded. Try again later." }))
				return
			}

			const url = new URL(req.url ?? "/", `http://${bindAddress}:${port}`)
			if (url.pathname !== "/mcp") {
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Not found" }))
				return
			}

			try {
				if (req.method === "POST") {
					await this.handlePost(req, res)
				} else if (req.method === "GET") {
					await this.handleGet(req, res)
				} else if (req.method === "DELETE") {
					await this.handleDelete(req, res)
				} else {
					res.writeHead(405, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "Method not allowed" }))
				}
			} catch (_error: unknown) {
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							jsonrpc: "2.0",
							error: { code: -32603, message: "Internal server error" },
							id: null,
						}),
					)
				}
			}
		})

		return new Promise<void>((resolve, reject) => {
			this.httpServer!.listen(port, bindAddress, () => {
				this.reclamationTimer = setInterval(() => {
					this.reclaimExpiredSessions()
				}, RECLAMATION_INTERVAL_MS)
				// Allow the timer to not prevent process exit
				if (
					this.reclamationTimer &&
					typeof this.reclamationTimer === "object" &&
					"unref" in this.reclamationTimer
				) {
					this.reclamationTimer.unref()
				}
				resolve()
			})
			this.httpServer!.on("error", reject)
		})
	}

	async stop(): Promise<void> {
		this.stopping = true
		try {
			if (this.reclamationTimer) {
				clearInterval(this.reclamationTimer)
				this.reclamationTimer = null
			}
			for (const timer of this.sandboxCleanupRetryTimers.values()) clearTimeout(timer)
			this.sandboxCleanupRetryTimers.clear()
			this.perIpLimiter.dispose()

			const sessionIds = Array.from(new Set([...this.transports.keys(), ...this.pendingSandboxCleanupSessions]))
			// Register cleanup before closing transports so onclose observes and
			// reuses the same in-flight Promise instead of starting a second cleanup.
			const scheduledCleanup = sessionIds.map((sessionId) => this.cleanupSandboxSession(sessionId))
			const cleanupResultsPromise = Promise.allSettled([
				...new Set([...this.sandboxCleanupFlights.values(), ...scheduledCleanup]),
			])
			const closePromises: Promise<void>[] = []
			for (const [sessionId, entry] of this.transports) {
				closePromises.push(
					entry.transport.close().catch((err) => {
						logger.debug("McpServer", `Transport close failed during stop for session ${sessionId}:`, err)
					}),
				)
			}
			await Promise.all(closePromises)
			this.transports.clear()

			await cleanupResultsPromise
			const retryResults = await Promise.allSettled(
				Array.from(this.pendingSandboxCleanupSessions).map((sessionId) =>
					this.cleanupSandboxSession(sessionId),
				),
			)

			if (this.httpServer) {
				const server = this.httpServer
				this.httpServer = null
				await new Promise<void>((resolve) => {
					server.close(() => resolve())
				})
			}

			const cleanupFailures = retryResults
				.filter((result): result is PromiseRejectedResult => result.status === "rejected")
				.map((result) => result.reason)
			if (cleanupFailures.length === 1) throw cleanupFailures[0]
			if (cleanupFailures.length > 1) {
				throw new AggregateError(cleanupFailures, "Failed to clean up MCP sandbox sessions")
			}
		} finally {
			this.ownedPathValidator?.dispose()
			this.ownedPathValidator = undefined
			this.ownedProtectedController = undefined
			this.pathValidatorInitialized = false
		}
	}

	private verifyAuth(req: http.IncomingMessage, token: string): boolean {
		const authHeader = req.headers["authorization"]
		if (!authHeader) return false
		const expected = `Bearer ${token}`
		if (authHeader.length !== expected.length) return false
		const a = Buffer.from(authHeader)
		const b = Buffer.from(expected)
		return crypto.timingSafeEqual(a, b)
	}

	private async parseBody(req: http.IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB limit
			let data = ""
			let size = 0
			req.on("data", (chunk) => {
				size += chunk.length
				if (size > MAX_BODY_SIZE) {
					req.destroy()
					reject(new Error("Request body too large"))
					return
				}
				data += chunk
			})
			req.on("end", () => {
				try {
					resolve(data ? JSON.parse(data) : undefined)
				} catch {
					reject(new Error("Invalid JSON body"))
				}
			})
			req.on("error", reject)
		})
	}

	/**
	 * Get the remote IP from the socket connection.
	 * Does NOT trust X-Forwarded-For unless the server is behind a trusted
	 * reverse proxy (not currently configured). Using the raw socket address
	 * prevents spoofed headers from bypassing per-IP rate limits.
	 */
	private getRemoteIp(req: http.IncomingMessage): string {
		return (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "")
	}

	/** Count sessions belonging to a given IP, including pending slots. */
	private countSessionsForIp(ip: string): number {
		let count = 0
		for (const entry of this.transports.values()) {
			if (entry.metadata.remoteIp === ip) count++
		}
		// Include pending slots for this IP
		count += this.pendingSlotsByIp.get(ip) ?? 0
		return count
	}

	private cleanupSandboxSession(sessionId: string): Promise<void> {
		const sandboxTaskId = `mcp:${sessionId}`
		const existing = this.sandboxCleanupFlights.get(sandboxTaskId)
		if (existing) return existing

		this.pendingSandboxCleanupSessions.add(sessionId)
		const cleanup = import("../sandbox")
			.then(({ SandboxExecutionService }) => SandboxExecutionService.getInstance().disposeTask(sandboxTaskId))
			.then(() => {
				this.pendingSandboxCleanupSessions.delete(sessionId)
				this.clearSandboxCleanupRetry(sessionId)
			})
			.finally(() => {
				this.sandboxCleanupFlights.delete(sandboxTaskId)
			})

		this.sandboxCleanupFlights.set(sandboxTaskId, cleanup)
		return cleanup
	}

	private scheduleSandboxSessionCleanup(sessionId: string): void {
		void this.cleanupSandboxSession(sessionId).catch((error) => {
			logger.warn("McpSession", "Sandbox cleanup failed; scheduling retry", { sessionId, error })
			this.scheduleSandboxCleanupRetry(sessionId)
		})
	}

	private scheduleSandboxCleanupRetry(sessionId: string): void {
		if (
			this.stopping ||
			!this.pendingSandboxCleanupSessions.has(sessionId) ||
			this.sandboxCleanupRetryTimers.has(sessionId)
		) {
			return
		}

		const attempt = this.sandboxCleanupRetryAttempts.get(sessionId) ?? 0
		const delayMs = SANDBOX_CLEANUP_RETRY_DELAYS_MS[attempt]
		if (delayMs === undefined) {
			logger.warn("McpSession", "Sandbox cleanup retry limit reached", { sessionId, attempts: attempt })
			return
		}

		this.sandboxCleanupRetryAttempts.set(sessionId, attempt + 1)
		const timer = setTimeout(() => {
			this.sandboxCleanupRetryTimers.delete(sessionId)
			void this.cleanupSandboxSession(sessionId).catch((error) => {
				logger.warn("McpSession", "Sandbox cleanup retry failed", {
					sessionId,
					attempt: attempt + 1,
					error,
				})
				this.scheduleSandboxCleanupRetry(sessionId)
			})
		}, delayMs)
		timer.unref?.()
		this.sandboxCleanupRetryTimers.set(sessionId, timer)
	}

	private clearSandboxCleanupRetry(sessionId: string): void {
		const timer = this.sandboxCleanupRetryTimers.get(sessionId)
		if (timer) clearTimeout(timer)
		this.sandboxCleanupRetryTimers.delete(sessionId)
		this.sandboxCleanupRetryAttempts.delete(sessionId)
	}

	private reclaimExpiredSessions(): void {
		const now = Date.now()
		const toClose: string[] = []
		const toForceDelete: string[] = []

		for (const [sid, entry] of this.transports) {
			// Skip sessions already in closing state
			if (entry.closing) {
				// Check if grace period has expired
				if (entry.graceDeadline !== null && now > entry.graceDeadline) {
					toForceDelete.push(sid)
				}
				continue
			}

			const idleMs = now - entry.metadata.lastActivityAt
			const ageMs = now - entry.metadata.createdAt
			const expired = idleMs > IDLE_TTL_MS || ageMs > ABSOLUTE_TTL_MS

			if (expired) {
				if (entry.requestsInFlight > 0) {
					// Enter grace period: mark as closing but wait for in-flight requests
					entry.closing = true
					entry.graceDeadline = now + GRACE_PERIOD_MS
					logger.debug(
						"McpSession",
						`Session ${sid} expired but has ${entry.requestsInFlight} in-flight request(s), entering grace period`,
					)
				} else {
					toClose.push(sid)
				}
			}
		}

		// Graceful close: wait for transport to close before deleting
		for (const sid of toClose) {
			const entry = this.transports.get(sid)
			if (entry) {
				this.metricsSessionsExpired++
				const reason = Date.now() - entry.metadata.createdAt > ABSOLUTE_TTL_MS ? "absolute_ttl" : "idle_ttl"
				logSecurityEvent({
					action: "mcp.session.expire",
					resource: sid,
					result: "allowed",
					reason,
				})
				entry.transport
					.close()
					.then(() => {
						this.transports.delete(sid)
						this.scheduleSandboxSessionCleanup(sid)
					})
					.catch((err) => {
						logger.debug("McpSession", `Transport close failed for session ${sid}:`, err)
						this.transports.delete(sid)
						this.scheduleSandboxSessionCleanup(sid)
					})
			}
		}

		// Force delete: grace period expired
		for (const sid of toForceDelete) {
			const entry = this.transports.get(sid)
			if (entry) {
				this.metricsSessionsExpired++
				logger.debug("McpSession", `Force-deleting session ${sid} after grace period expired`)
				logSecurityEvent({
					action: "mcp.session.expire",
					resource: sid,
					result: "allowed",
					reason: "grace_period_expired",
				})
				entry.transport.close().catch((err) => {
					logger.debug("McpSession", `Transport close failed during force-delete for ${sid}:`, err)
				})
				this.transports.delete(sid)
				this.scheduleSandboxSessionCleanup(sid)
			}
		}
	}

	private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this.parseBody(req)
		const sessionId = req.headers["mcp-session-id"] as string | undefined

		if (sessionId && this.transports.has(sessionId)) {
			const entry = this.transports.get(sessionId)!
			// Reject new requests on sessions in closing state (grace period only waits for existing in-flight)
			if (entry.closing) {
				res.writeHead(503, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: { code: -32000, message: "Session is closing. Please create a new session." },
						id: null,
					}),
				)
				return
			}
			entry.metadata.lastActivityAt = Date.now()
			entry.requestsInFlight++
			try {
				await entry.transport.handleRequest(req, res, body)
			} finally {
				entry.requestsInFlight = Math.max(0, entry.requestsInFlight - 1)
			}
			return
		}

		if (!sessionId && isInitializeRequest(body)) {
			if (this.stopping) {
				res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" })
				res.end(JSON.stringify({ error: "MCP server is stopping" }))
				return
			}
			const remoteIp = this.getRemoteIp(req)

			// Reserve slot atomically before creating transport
			const effectiveGlobalCount = this.transports.size + this.pendingSlots
			if (effectiveGlobalCount >= MAX_SESSIONS) {
				this.metricsSessionsRejected++
				logSecurityEvent({
					action: "mcp.session.create",
					resource: remoteIp,
					result: "denied",
					reason: "max_sessions_reached",
				})
				res.writeHead(503, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: { code: -32000, message: "Maximum session count reached. Try again later." },
						id: null,
					}),
				)
				return
			}

			// Per-IP session limit (includes pending slots)
			if (this.countSessionsForIp(remoteIp) >= MAX_SESSIONS_PER_IP) {
				this.metricsSessionsRejected++
				logSecurityEvent({
					action: "mcp.session.create",
					resource: remoteIp,
					result: "denied",
					reason: "max_sessions_per_ip",
				})
				res.writeHead(429, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: { code: -32000, message: "Too many sessions from this IP." },
						id: null,
					}),
				)
				return
			}

			// Atomically reserve the slot
			this.pendingSlots++
			this.pendingSlotsByIp.set(remoteIp, (this.pendingSlotsByIp.get(remoteIp) ?? 0) + 1)

			const releasePendingSlot = (): void => {
				this.pendingSlots = Math.max(0, this.pendingSlots - 1)
				const ipPending = (this.pendingSlotsByIp.get(remoteIp) ?? 1) - 1
				if (ipPending <= 0) {
					this.pendingSlotsByIp.delete(remoteIp)
				} else {
					this.pendingSlotsByIp.set(remoteIp, ipPending)
				}
			}

			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (sid) => {
					// Convert pending slot to formal entry
					releasePendingSlot()
					if (this.stopping) {
						void transport.close().catch((error) => {
							logger.debug("McpSession", "Failed to close session initialized during stop", {
								sessionId: sid,
								error,
							})
						})
						return
					}
					this.metricsSessionsCreated++
					this.transports.set(sid, {
						transport,
						metadata: {
							sessionId: sid,
							createdAt: Date.now(),
							lastActivityAt: Date.now(),
							remoteIp,
						},
						requestsInFlight: 0,
						closing: false,
						graceDeadline: null,
					})
				},
			})

			transport.onclose = () => {
				const sid = transport.sessionId
				if (sid) {
					this.transports.delete(sid)
					this.scheduleSandboxSessionCleanup(sid)
				}
			}

			try {
				const mcpServer = this.createMcpServer(() => transport.sessionId)
				await mcpServer.connect(transport)
				await transport.handleRequest(req, res, body)
			} catch (err) {
				// Release pending slot if transport setup fails and onsessioninitialized never fired
				if (!transport.sessionId) {
					releasePendingSlot()
				}
				throw err
			}
			return
		}

		res.writeHead(400, { "Content-Type": "application/json" })
		res.end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Bad Request: No valid session ID provided" },
				id: null,
			}),
		)
	}

	private async handleGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined
		if (!sessionId || !this.transports.has(sessionId)) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Invalid or missing session ID" }))
			return
		}

		const entry = this.transports.get(sessionId)!
		if (entry.closing) {
			res.writeHead(503, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Session is closing" }))
			return
		}
		entry.metadata.lastActivityAt = Date.now()
		entry.requestsInFlight++
		try {
			await entry.transport.handleRequest(req, res)
		} finally {
			entry.requestsInFlight = Math.max(0, entry.requestsInFlight - 1)
		}
	}

	private async handleDelete(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined
		if (!sessionId || !this.transports.has(sessionId)) {
			res.writeHead(400, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Invalid or missing session ID" }))
			return
		}

		const entry = this.transports.get(sessionId)!
		if (entry.closing) {
			res.writeHead(503, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: "Session is closing" }))
			return
		}
		entry.metadata.lastActivityAt = Date.now()
		entry.requestsInFlight++
		try {
			await entry.transport.handleRequest(req, res)
		} finally {
			entry.requestsInFlight = Math.max(0, entry.requestsInFlight - 1)
		}
	}
}
