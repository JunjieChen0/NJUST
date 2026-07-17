/**
 * Docker Auth Forwarder
 *
 * Lightweight HTTP proxy that adds a Bearer token to Docker API requests.
 * Runs inside web/runner containers to forward Docker CLI calls to the
 * policy proxy with authentication.
 *
 * Supports both standard HTTP and Connection: Upgrade (attach/exec).
 *
 * Usage:
 *   DOCKER_AUTH_TOKEN=<token> DOCKER_UPSTREAM=http://docker-proxy:2375 \
 *   node docker-auth-forwarder.mjs
 *
 * Then set DOCKER_HOST=tcp://127.0.0.1:2376 inside the container.
 */

import * as http from "http"
import * as net from "net"
import { URL } from "url"

/* eslint-disable no-undef */

const LISTEN_PORT = parseInt(process.env.DOCKER_AUTH_FORWARD_PORT ?? "2376", 10)
const UPSTREAM = process.env.DOCKER_UPSTREAM ?? "http://docker-proxy:2375"
const TOKEN = process.env.DOCKER_AUTH_TOKEN

if (!TOKEN) {
	console.error("[docker-auth-forwarder] FATAL: DOCKER_AUTH_TOKEN is not set.")
	process.exit(1)
}

const upstreamUrl = new URL(UPSTREAM)
const upstreamPort = parseInt(upstreamUrl.port, 10) || 2375

const server = http.createServer((req, res) => {
	const options = {
		hostname: upstreamUrl.hostname,
		port: upstreamPort,
		path: req.url,
		method: req.method,
		headers: {
			...req.headers,
			host: upstreamUrl.host,
			authorization: `Bearer ${TOKEN}`,
		},
	}

	// Remove hop-by-hop headers from client
	delete options.headers["connection"]

	const proxyReq = http.request(options, (proxyRes) => {
		res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
		res.flushHeaders()
		proxyRes.pipe(res)
	})

	proxyReq.on("error", (err) => {
		console.error("[docker-auth-forwarder] upstream error:", err.message)
		if (!res.headersSent) {
			res.writeHead(502, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ message: "Upstream connection error" }))
		}
	})

	req.pipe(proxyReq)
})

// Handle Connection: Upgrade (Docker attach/exec hijack)
server.on("upgrade", (req, clientSocket, head) => {
	const upstreamSocket = net.connect(upstreamPort, upstreamUrl.hostname)

	upstreamSocket.on("connect", () => {
		// Build the upgrade request to upstream with auth header
		const headers = [
			`${req.method} ${req.url} HTTP/1.1`,
			`Host: ${upstreamUrl.host}`,
			`Authorization: Bearer ${TOKEN}`,
		]

		// Forward original headers
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

		// Write any buffered data from the initial upgrade handshake
		if (head && head.length > 0) {
			upstreamSocket.write(head)
		}

		// Bidirectional pipe: client <-> upstream
		clientSocket.pipe(upstreamSocket)
		upstreamSocket.pipe(clientSocket)
	})

	upstreamSocket.on("error", (err) => {
		console.error("[docker-auth-forwarder] upstream socket error:", err.message)
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
})

server.listen(LISTEN_PORT, "127.0.0.1", () => {
	console.log(`[docker-auth-forwarder] Listening on 127.0.0.1:${LISTEN_PORT}`)
	console.log(`[docker-auth-forwarder] Upstream: ${UPSTREAM}`)
	console.log(`[docker-auth-forwarder] Auth: enabled`)
})

process.on("SIGTERM", () => {
	server.close(() => process.exit(0))
})
process.on("SIGINT", () => {
	server.close(() => process.exit(0))
})
