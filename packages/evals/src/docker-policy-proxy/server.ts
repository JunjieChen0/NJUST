/**
 * Docker Policy Proxy — Proxy Server
 *
 * HTTP proxy that intercepts Docker API requests, validates them against
 * the configured policy, and forwards allowed requests to the Docker daemon.
 *
 * Listens on TCP (default 2375) and proxies to Docker socket or TCP endpoint.
 * Auth token is REQUIRED for production use.
 */

import * as crypto from "crypto"
import * as http from "http"
import * as net from "net"
import { URL } from "url"

import { logger } from "./logger"
import { logSecurityEvent } from "./security-audit"

import type { PolicyConfig, DockerCreateContainerRequest, DockerKillContainerRequest } from "./types"
import { validateCreateContainer, validateKillContainer, isMethodAllowed, DEFAULT_POLICY } from "./policy"

const SCOPE = "DockerPolicyProxy"
/** Maximum request body size: 10 MB */
const MAX_BODY_SIZE = 10 * 1024 * 1024

export interface ProxyServerOptions {
	/** Port to listen on */
	port: number

	/** Address to bind to (default: 0.0.0.0) */
	bindAddress?: string

	/** Docker daemon socket path or TCP URL */
	dockerEndpoint: string

	/** Policy configuration */
	policy?: PolicyConfig

	/** Auth token required for proxy access. MUST be set - proxy refuses to start without it. */
	authToken: string
}

export class DockerPolicyProxy {
	private httpServer: http.Server | null = null
	private options: ProxyServerOptions
	private policy: PolicyConfig

	constructor(options: ProxyServerOptions) {
		this.options = options
		this.policy = options.policy ?? DEFAULT_POLICY
	}

	/**
	 * Timing-safe Bearer token verification.
	 * Uses crypto.timingSafeEqual to prevent timing side-channel attacks.
	 */
	private verifyBearerToken(authHeader: string | undefined, token: string): boolean {
		if (!authHeader) return false
		const expected = `Bearer ${token}`
		if (authHeader.length !== expected.length) return false
		return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
	}

	async start(): Promise<void> {
		const { port, bindAddress = "0.0.0.0", authToken } = this.options

		// Fail-closed: refuse to start without an auth token
		if (!authToken) {
			throw new Error(
				"PROXY_AUTH_TOKEN is required. The Docker policy proxy will not start without authentication. " +
				"Set PROXY_AUTH_TOKEN in your environment or docker-compose.yml."
			)
		}

		this.httpServer = http.createServer(async (req, res) => {
			// Auth check - always enforced (fail-closed above guarantees authToken is set)
			const authHeader = req.headers["authorization"]
			if (!this.verifyBearerToken(authHeader, authToken)) {
				logger.warn(SCOPE, "Unauthorized request", { ip: req.socket.remoteAddress })
				logSecurityEvent({
					action: "docker.proxy.auth",
					resource: req.url ?? "/",
					result: "denied",
					reason: "missing or invalid bearer token",
				})
				res.writeHead(401, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ message: "Unauthorized" }))
				return
			}

			await this.handleRequest(req, res)
		})

		// Register upgrade handler for Docker attach/exec
		this.httpServer.on("upgrade", (req, socket, head) => {
			this.handleUpgrade(req, socket as net.Socket, head)
		})

		return new Promise<void>((resolve, reject) => {
			this.httpServer!.listen(port, bindAddress, () => {
				logger.info(SCOPE, `Docker policy proxy listening on ${bindAddress}:${port}`)
				logger.info(SCOPE, `Proxying to Docker endpoint: ${this.options.dockerEndpoint}`)
				resolve()
			})
			this.httpServer!.on("error", reject)
		})
	}

	async stop(): Promise<void> {
		if (this.httpServer) {
			return new Promise<void>((resolve) => {
				this.httpServer!.close(() => {
					logger.info(SCOPE, "Docker policy proxy stopped")
					resolve()
				})
			})
		}
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const method = req.method ?? "GET"
		const urlPath = req.url ?? "/"
		const clientIp = req.socket.remoteAddress ?? "unknown"

		logger.debug(SCOPE, `${method} ${urlPath} from ${clientIp}`)

		try {
			// Check if method/path is allowed
			if (!isMethodAllowed(method, urlPath)) {
				const reason = `Method/path not allowed: ${method} ${urlPath}`
				logger.warn(SCOPE, reason)
				logSecurityEvent({
					action: "docker.proxy.denied",
					resource: `${method} ${urlPath}`,
					result: "denied",
					reason,
				})
				res.writeHead(403, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ message: reason }))
				return
			}

			// Read request body for POST/PUT
			let body = ""
			if (method === "POST" || method === "PUT") {
				body = await readBody(req)
			}

			// Validate specific operations
			const decision = await this.validateRequest(method, urlPath, body)
			if (!decision.allowed) {
				logger.warn(SCOPE, `Policy denied: ${decision.reason}`)
				logSecurityEvent({
					action: "docker.proxy.policy_denied",
					resource: `${method} ${urlPath}`,
					result: "denied",
					reason: decision.reason ?? "Policy denied",
				})
				res.writeHead(403, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ message: `Policy denied: ${decision.reason}` }))
				return
			}

			// Rewrite URL if needed (e.g., inject filters for /containers/json)
			const effectiveUrlPath = this.rewriteUrl(method, urlPath)

			// Forward to Docker daemon
			await this.forwardRequest(req, res, body, effectiveUrlPath)
		} catch (error) {
			logger.error(SCOPE, "Error handling request", error)
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ message: "Internal proxy error" }))
			}
		}
	}

	private handleUpgrade(
		req: http.IncomingMessage,
		clientSocket: net.Socket,
		head: Buffer,
	): void {
		const { authToken, dockerEndpoint } = this.options
		const urlPath = req.url ?? "/"

		// Auth check
		const authHeader = req.headers["authorization"]
		if (!this.verifyBearerToken(authHeader, authToken)) {
			clientSocket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
			clientSocket.destroy()
			return
		}

		// Policy check: only allow attach/exec endpoints
		const parsedUrl = new URL(urlPath, "http://localhost")
		const normalizedPath = parsedUrl.pathname.replace(/^\/v[\d.]+/, "")

		if (!normalizedPath.match(/\/containers\/[^/]+\/(attach|exec)/) &&
			!normalizedPath.match(/\/exec\/[^/]+\/start/)) {
			clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
			clientSocket.destroy()
			return
		}

		// Verify container name prefix for container endpoints
		if (normalizedPath.match(/\/containers\/[^/]+\/(attach|exec)/)) {
			const containerId = normalizedPath.split("/")[2]
			// Async verify then connect
			this.verifyContainerNamePrefix(containerId).then(decision => {
				if (!decision.allowed) {
					clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
					clientSocket.destroy()
					return
				}
				this.connectAndPipe(req, clientSocket, head, dockerEndpoint, urlPath)
			}).catch((err) => {
				logger.error(SCOPE, "Upgrade verification error", err)
				clientSocket.destroy()
			})
		} else if (normalizedPath.match(/\/exec\/[^/]+\/start/)) {
			const execId = normalizedPath.split("/")[2] ?? ""
			this.verifyExecContainerPrefix(execId).then(decision => {
				if (!decision.allowed) {
					clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
					clientSocket.destroy()
					return
				}
				this.connectAndPipe(req, clientSocket, head, dockerEndpoint, urlPath)
			}).catch((err) => {
				logger.error(SCOPE, "Upgrade exec verification error", err)
				clientSocket.destroy()
			})
		}
	}

	private connectAndPipe(
		req: http.IncomingMessage,
		clientSocket: net.Socket,
		head: Buffer,
		dockerEndpoint: string,
		urlPath: string,
	): void {
		let upstreamSocket: net.Socket

		if (dockerEndpoint.startsWith("unix://")) {
			const socketPath = dockerEndpoint.replace("unix://", "")
			upstreamSocket = net.createConnection(socketPath)
		} else if (dockerEndpoint.startsWith("tcp://")) {
			const url = new URL(dockerEndpoint)
			const host = url.hostname
			const port = parseInt(url.port, 10) || 2375
			upstreamSocket = net.createConnection(port, host)
		} else {
			clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n")
			clientSocket.destroy()
			return
		}

		upstreamSocket.on("connect", () => {
			const method = req.method ?? "POST"
			const headers: string[] = [
				`${method} ${urlPath} HTTP/1.1`,
				`Host: localhost`,
			]

			for (const [key, value] of Object.entries(req.headers)) {
				const lk = key.toLowerCase()
				if (lk !== "host" && lk !== "authorization") {
					if (Array.isArray(value)) {
						for (const v of value) {
							headers.push(`${key}: ${v}`)
						}
					} else if (value) {
						headers.push(`${key}: ${value}`)
					}
				}
			}

			headers.push("", "")
			upstreamSocket.write(headers.join("\r\n"))

			if (head && head.length > 0) {
				upstreamSocket.write(head)
			}

			clientSocket.pipe(upstreamSocket)
			upstreamSocket.pipe(clientSocket)
		})

		upstreamSocket.on("error", (err) => {
			logger.error(SCOPE, "Upgrade upstream error", err)
			clientSocket.destroy()
		})

		clientSocket.on("error", () => {
			upstreamSocket.destroy()
		})

		clientSocket.on("close", () => {
			upstreamSocket.destroy()
		})

		upstreamSocket.on("close", () => {
			clientSocket.destroy()
		})
	}

	private async validateRequest(method: string, urlPath: string, body: string): Promise<{ allowed: boolean; reason?: string }> {
		// Parse URL to extract path and query separately
		const parsedUrl = new URL(urlPath, "http://localhost")
		const normalizedPath = parsedUrl.pathname.replace(/^\/v[\d.]+/, "")

		// Validate container creation - name comes from query param ?name=xxx
		if (method === "POST" && normalizedPath === "/containers/create") {
			if (!body) {
				return { allowed: false, reason: "Container create requires a JSON body" }
			}
			try {
				const reqBody: DockerCreateContainerRequest = JSON.parse(body)
				// Docker API puts container name in the query string, not the body
				const nameFromQuery = parsedUrl.searchParams.get("name") ?? undefined
				// Container name is REQUIRED - auto-named containers bypass policy
				const containerName = nameFromQuery ?? reqBody.Name
				if (!containerName) {
					return { allowed: false, reason: "Container name is required (use ?name=xxx query parameter)" }
				}
				reqBody.Name = containerName
				const decision = validateCreateContainer(reqBody, this.policy)
				return decision
			} catch (error) {
				return { allowed: false, reason: `Invalid request body: ${error}` }
			}
		}

		// Validate container kill — verify target container name prefix via inspect
		if (method === "POST" && normalizedPath.match(/\/containers\/[^/]+\/kill/)) {
			const containerId = normalizedPath.split("/")[2]
			try {
				const reqBody: DockerKillContainerRequest = body ? JSON.parse(body) : {}
				// Verify target container belongs to our managed set
				const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
				if (!nameCheck.allowed) {
					return nameCheck
				}
				const decision = validateKillContainer(containerId ?? "", reqBody, this.policy)
				return decision
			} catch {
				// Kill requests may have empty body — still enforce name check
				return await this.verifyContainerNamePrefix(containerId)
			}
		}

		// Validate start/stop/delete/wait/resize — verify target container name prefix
		if (method === "POST" && (
			normalizedPath.match(/\/containers\/[^/]+\/start$/) ||
			normalizedPath.match(/\/containers\/[^/]+\/stop$/) ||
			normalizedPath.match(/\/containers\/[^/]+\/wait$/) ||
			normalizedPath.match(/\/containers\/[^/]+\/resize$/)
		)) {
			const containerId = normalizedPath.split("/")[2]
			const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
			if (!nameCheck.allowed) return nameCheck
		}

		// Validate attach — verify target container name prefix
		if (method === "POST" && normalizedPath.match(/\/containers\/[^/]+\/attach/)) {
			const containerId = normalizedPath.split("/")[2]
			const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
			if (!nameCheck.allowed) return nameCheck
		}

		// Validate exec on container — verify target container name prefix
		if (method === "POST" && normalizedPath.match(/\/containers\/[^/]+\/exec$/)) {
			const containerId = normalizedPath.split("/")[2]
			const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
			if (!nameCheck.allowed) return nameCheck
		}

		if (method === "DELETE" && normalizedPath.match(/\/containers\/[^/]+/)) {
			const containerId = normalizedPath.split("/")[2]
			const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
			if (!nameCheck.allowed) return nameCheck
		}

		// Validate GET on specific containers (inspect, logs) — verify name prefix
		// List (GET /containers/json) is allowed without prefix check (returns all containers)
		if (method === "GET" && normalizedPath.match(/\/containers\/[^/]+\/(json|logs)/)) {
			const containerId = normalizedPath.split("/")[2]
			const nameCheck = await this.verifyContainerNamePrefix(containerId ?? "")
			if (!nameCheck.allowed) return nameCheck
		}

		// Validate /exec/{id}/start — verify exec instance belongs to managed container
		if (method === "POST" && normalizedPath.match(/\/exec\/[^/]+\/start$/)) {
			const execId = normalizedPath.split("/")[2]
			const execCheck = await this.verifyExecContainerPrefix(execId ?? "")
			if (!execCheck.allowed) return execCheck
		}

		// Validate /exec/{id}/resize — verify exec instance belongs to managed container
		if (method === "POST" && normalizedPath.match(/\/exec\/[^/]+\/resize$/)) {
			const execId = normalizedPath.split("/")[2]
			const execCheck = await this.verifyExecContainerPrefix(execId ?? "")
			if (!execCheck.allowed) return execCheck
		}

		// All other allowed methods pass through
		return { allowed: true }
	}

	/**
	 * Rewrite the request URL before forwarding.
	 * Injects filters for /containers/json to limit results to managed containers.
	 */
	private rewriteUrl(method: string, urlPath: string): string {
		const parsedUrl = new URL(urlPath, "http://localhost")
		const normalizedPath = parsedUrl.pathname.replace(/^\/v[\d.]+/, "")

		// Inject name filter for /containers/json to only return managed containers
		if (method === "GET" && normalizedPath === "/containers/json") {
			const existingFilters = parsedUrl.searchParams.get("filters")
			let filters: Record<string, string[]> = {}
			if (existingFilters) {
				try {
					filters = JSON.parse(existingFilters)
				} catch {
					filters = {}
				}
			}
			// Inject name prefix filter
			filters["name"] = [this.policy.requiredNamePrefix]
			parsedUrl.searchParams.set("filters", JSON.stringify(filters))
			return parsedUrl.pathname + parsedUrl.search
		}

		return urlPath
	}

	/**
	 * Verify that an exec instance belongs to a managed container.
	 * Queries GET /exec/{id}/json to get ContainerID, then checks name prefix.
	 */
	private async verifyExecContainerPrefix(execId: string): Promise<{ allowed: boolean; reason?: string }> {
		if (!execId) {
			return { allowed: false, reason: "Missing exec ID" }
		}

		try {
			const execInfo = await this.inspectExec(execId)
			if (execInfo && execInfo.ContainerID) {
				return await this.verifyContainerNamePrefix(execInfo.ContainerID)
			}
			return { allowed: false, reason: `Cannot verify exec instance '${execId}'` }
		} catch (error) {
			return { allowed: false, reason: `Failed to inspect exec '${execId}': ${error}` }
		}
	}

	/**
	 * Query the Docker daemon via http.request (auto-handles chunked responses).
	 */
	private dockerInspect(path: string): Promise<unknown | null> {
		return new Promise((resolve) => {
			const { dockerEndpoint } = this.options
			const requestOpts: http.RequestOptions = {
				method: "GET",
				path,
				timeout: 5000,
			}

			if (dockerEndpoint.startsWith("unix://")) {
				requestOpts.socketPath = dockerEndpoint.replace("unix://", "")
			} else if (dockerEndpoint.startsWith("tcp://")) {
				const url = new URL(dockerEndpoint)
				requestOpts.hostname = url.hostname
				requestOpts.port = parseInt(url.port, 10) || 2375
			} else {
				resolve(null)
				return
			}

			const req = http.request(requestOpts, (res) => {
				const chunks: Buffer[] = []
				res.on("data", (chunk: Buffer) => chunks.push(chunk))
				res.on("end", () => {
					try {
						const body = Buffer.concat(chunks).toString()
						const data = JSON.parse(body)
						resolve(data)
					} catch {
						resolve(null)
					}
				})
			})

			req.on("error", () => resolve(null))
			req.on("timeout", () => {
				req.destroy()
				resolve(null)
			})

			req.end()
		})
	}

	/**
	 * Inspect an exec instance via the Docker daemon.
	 */
	private async inspectExec(execId: string): Promise<{ ContainerID?: string } | null> {
		return this.dockerInspect(`/exec/${execId}/json`) as Promise<{ ContainerID?: string } | null>
	}

	/**
	 * Verify that a container (by ID or name) has the required name prefix.
	 * Queries the Docker daemon to inspect the container if the ID is not the name itself.
	 */
	private async verifyContainerNamePrefix(containerId: string | undefined): Promise<{ allowed: boolean; reason?: string }> {
		if (!containerId) {
			return { allowed: false, reason: "Missing container ID" }
		}

		// If the ID looks like a name (starts with our prefix), allow directly
		if (containerId.startsWith(this.policy.requiredNamePrefix)) {
			return { allowed: true }
		}

		// Otherwise, inspect the container via Docker API to get its real name
		try {
			const inspectData = await this.inspectContainer(containerId)
			if (inspectData && inspectData.Name) {
				// Docker prepends "/" to container names
				const name = inspectData.Name.replace(/^\//, "")
				if (!name.startsWith(this.policy.requiredNamePrefix)) {
					return {
						allowed: false,
						reason: `Container '${name}' does not have required prefix '${this.policy.requiredNamePrefix}'`,
					}
				}
				return { allowed: true }
			}
			// If inspect fails, deny for safety
			return { allowed: false, reason: `Cannot verify container '${containerId}' name prefix` }
		} catch (error) {
			return { allowed: false, reason: `Failed to inspect container '${containerId}': ${error}` }
		}
	}

	/**
	 * Inspect a container via the Docker daemon.
	 */
	private async inspectContainer(containerId: string): Promise<{ Name?: string } | null> {
		return this.dockerInspect(`/containers/${containerId}/json`) as Promise<{ Name?: string } | null>
	}

	private async forwardRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		body: string,
		effectiveUrlPath?: string,
	): Promise<void> {
		const { dockerEndpoint } = this.options
		const method = req.method ?? "GET"
		const urlPath = effectiveUrlPath ?? req.url ?? "/"

		// Detect long-poll endpoints (e.g., /containers/{id}/wait) that may block for minutes
		const parsedPath = new URL(urlPath, "http://localhost").pathname.replace(/^\/v[\d.]+/, "")
		const isLongPoll = !!parsedPath.match(/\/containers\/[^/]+\/wait/)

		// Build http.request options based on Docker endpoint type
		const requestOpts: http.RequestOptions = {
			method,
			path: urlPath,
			headers: {} as Record<string, string | string[]>,
			timeout: isLongPoll ? 0 : 60000,
		}

		if (dockerEndpoint.startsWith("unix://")) {
			const socketPath = dockerEndpoint.replace("unix://", "")
			requestOpts.socketPath = socketPath
		} else if (dockerEndpoint.startsWith("tcp://")) {
			const url = new URL(dockerEndpoint)
			requestOpts.hostname = url.hostname
			requestOpts.port = parseInt(url.port, 10) || 2375
		} else {
			throw new Error(`Unsupported Docker endpoint: ${dockerEndpoint}`)
		}

		// Copy request headers (strip proxy-specific ones)
		const forwardHeaders: Record<string, string | string[]> = {}
		for (const [key, value] of Object.entries(req.headers)) {
			const lk = key.toLowerCase()
			if (lk !== "host" && lk !== "authorization" && lk !== "connection") {
				forwardHeaders[key] = value!
			}
		}
		// Override content-length if we have a body
		if (body) {
			forwardHeaders["content-length"] = String(Buffer.byteLength(body))
		}
		requestOpts.headers = forwardHeaders

		return new Promise<void>((resolve) => {
			const proxyReq = http.request(requestOpts, (proxyRes) => {
				// Forward status code and headers — Node handles chunked decoding automatically
				res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
				res.flushHeaders()
				// Pipe the decoded body to the client response
				proxyRes.pipe(res)
				proxyRes.on("end", () => resolve())
			})

			proxyReq.on("error", (error) => {
				logger.error(SCOPE, "Failed to connect to Docker daemon", error)
				if (!res.headersSent) {
					res.writeHead(502, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ message: "Failed to connect to Docker daemon" }))
				}
				resolve()
			})

			proxyReq.on("timeout", () => {
				logger.error(SCOPE, "Docker daemon request timeout")
				proxyReq.destroy()
				if (!res.headersSent) {
					res.writeHead(504, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ message: "Docker daemon timeout" }))
				}
				resolve()
			})

			if (body) {
				proxyReq.write(body)
			}
			proxyReq.end()
		})
	}

}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = ""
		let totalBytes = 0
		req.on("data", (chunk: Buffer) => {
			totalBytes += chunk.length
			if (totalBytes > MAX_BODY_SIZE) {
				req.destroy()
				reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes limit`))
				return
			}
			data += chunk.toString()
		})
		req.on("end", () => resolve(data))
		req.on("error", reject)
	})
}
