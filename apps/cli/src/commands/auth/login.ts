import http from "http"
import { randomBytes } from "crypto"
import { exec } from "child_process"

import { AUTH_BASE_URL } from "@/types/index.js"
import { saveToken } from "@/lib/storage/index.js"
import { isTokenValid } from "@/lib/auth/token.js"

export interface LoginOptions {
	timeout?: number
	verbose?: boolean
}

export type LoginResult =
	| {
			success: true
			token: string
	  }
	| {
			success: false
			error: string
	  }

const LOCALHOST = "127.0.0.1"
const MAX_URL_LENGTH = 4096
const MAX_TOKEN_LENGTH = 4096
const CALLBACK_PATH = "/callback"

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function isJwtFormat(token: string): boolean {
	const parts = token.split(".")
	if (parts.length !== 3) return false
	return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part))
}

export async function login({ timeout = 5 * 60 * 1000, verbose = false }: LoginOptions = {}): Promise<LoginResult> {
	const state = randomBytes(16).toString("hex")

	if (verbose) {
		console.log("[Auth] Starting local callback server...")
	}

	const tokenDeferred = createDeferred<{ token: string; state: string }>()

	let serverPort = 0
	let timeoutId: ReturnType<typeof setTimeout> | undefined
	let settled = false

	const server = http.createServer((req, res) => {
		const reqHost = `http://${LOCALHOST}:${serverPort}`

		if (req.method !== "GET") {
			res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" })
			res.end("Method Not Allowed")
			return
		}

		const rawUrl = req.url ?? ""
		if (rawUrl.length > MAX_URL_LENGTH) {
			res.writeHead(414, { "Content-Type": "text/plain" })
			res.end("URI Too Long")
			return
		}

		let url: URL
		try {
			url = new URL(rawUrl, reqHost)
		} catch {
			res.writeHead(400, { "Content-Type": "text/plain" })
			res.end("Bad request")
			return
		}

		if (url.pathname !== CALLBACK_PATH) {
			res.writeHead(404, { "Content-Type": "text/plain" })
			res.end("Not found")
			return
		}

		if (settled) {
			res.writeHead(409, { "Content-Type": "text/plain" })
			res.end("Callback already processed")
			return
		}

		const receivedState = url.searchParams.get("state")
		const token = url.searchParams.get("token")
		const error = url.searchParams.get("error")

		res.setHeader("Connection", "close")

		if (error) {
			settled = true
			const safeError = sanitizeForUrl(error)
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=error-in-callback`)
			errorUrl.searchParams.set("message", safeError)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Authentication error from provider"))
			})
			return
		}

		if (!token) {
			settled = true
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=missing-token`)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Missing token in callback"))
			})
			return
		}

		if (token.length > MAX_TOKEN_LENGTH) {
			settled = true
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=token-too-long`)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Token exceeds maximum length"))
			})
			return
		}

		if (!isJwtFormat(token)) {
			settled = true
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=invalid-token-format`)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Invalid token format"))
			})
			return
		}

		if (!isTokenValid(token)) {
			settled = true
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=invalid-token`)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Token validation failed"))
			})
			return
		}

		if (receivedState !== state) {
			settled = true
			const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=invalid-state-parameter`)
			res.writeHead(302, { Location: errorUrl.toString() })
			res.end(() => {
				closeServer()
				tokenDeferred.reject(new Error("Invalid state parameter"))
			})
			return
		}

		settled = true
		res.writeHead(302, { Location: `${AUTH_BASE_URL}/cli/sign-in?success=true` })
		res.end(() => {
			closeServer()
			tokenDeferred.resolve({ token, state: receivedState! })
		})
	})

	function closeServer(): void {
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = undefined
		}
		server.close()
	}

	server.on("close", () => {
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = undefined
		}
	})

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (timeoutId) {
			clearTimeout(timeoutId)
			timeoutId = undefined
		}
		tokenDeferred.reject(err)
	})

	await new Promise<void>((resolve, reject) => {
		server.once("listening", () => {
			const addr = server.address()
			if (addr && typeof addr === "object") {
				serverPort = addr.port
			}
			timeoutId = setTimeout(() => {
				closeServer()
				if (!settled) {
					tokenDeferred.reject(new Error("Authentication timed out"))
				}
			}, timeout)
			resolve()
		})
		server.once("error", reject)
		server.listen(0, LOCALHOST)
	})

	const host = `http://${LOCALHOST}:${serverPort}`
	const authUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in`)
	authUrl.searchParams.set("state", state)
	authUrl.searchParams.set("callback", `${host}/callback`)

	console.log("Opening browser for authentication...")
	console.log(`If the browser doesn't open, visit: ${authUrl.toString()}`)

	try {
		await openBrowser(authUrl.toString())
	} catch (error) {
		if (verbose) {
			console.warn("[Auth] Failed to open browser automatically:", error)
		}

		console.log("Please open the URL above in your browser manually.")
	}

	try {
		const { token } = await tokenDeferred.promise
		await saveToken(token)
		console.log("✓ Successfully authenticated!")
		return { success: true, token }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`✗ Authentication failed: ${message}`)
		return { success: false, error: message }
	}
}

function sanitizeForUrl(value: string): string {
	return value.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 200)
}

function openBrowser(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const platform = process.platform
		let command: string

		switch (platform) {
			case "darwin":
				command = `open "${url}"`
				break
			case "win32":
				command = `start "" "${url}"`
				break
			default:
				command = `xdg-open "${url}"`
				break
		}

		exec(command, (error) => {
			if (error) {
				reject(error)
			} else {
				resolve()
			}
		})
	})
}
