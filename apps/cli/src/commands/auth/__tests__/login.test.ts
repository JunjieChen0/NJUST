import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import http from "http"
import type { Server } from "http"

const mockSaveToken = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@/lib/storage/index.js", () => ({
	saveToken: mockSaveToken,
}))

vi.mock("child_process", () => ({
	exec: vi.fn((_cmd: string, cb: (error: Error | null) => void) => {
		cb(null)
	}),
}))

vi.mock("@/types/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/types/index.js")>()
	return {
		...actual,
		AUTH_BASE_URL: "https://auth.test.example.com",
	}
})

import { login } from "../login.js"

function base64urlEncode(data: string): string {
	return Buffer.from(data, "utf-8").toString("base64url")
}

function createValidJwt(expSeconds: number): string {
	const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
	const payload = base64urlEncode(
		JSON.stringify({
			iss: "njust-ai",
			sub: "user-123",
			exp: expSeconds,
			iat: Math.floor(Date.now() / 1000),
			nbf: Math.floor(Date.now() / 1000),
			v: 1,
			r: { t: "access" },
		}),
	)
	const signature = base64urlEncode("signature")
	return `${header}.${payload}.${signature}`
}

const VALID_TOKEN = createValidJwt(Math.floor(Date.now() / 1000) + 3600)
const EXPIRED_TOKEN = createValidJwt(Math.floor(Date.now() / 1000) - 3600)

interface TestContext {
	port: number
	state: string
	loginPromise: ReturnType<typeof login>
}

async function startLogin(timeout = 2000): Promise<TestContext> {
	let _capturedServer: Server | null = null
	const origCreate = http.createServer
	const origListen = http.Server.prototype.listen

	http.createServer = ((handler: Parameters<typeof http.createServer>[0]) => {
		const server = origCreate.call(http, handler)
		_capturedServer = server
		return server
	}) as typeof http.createServer

	http.Server.prototype.listen = function (this: Server, ...args: unknown[]): Server {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const original = this
		const cb = args[args.length - 1]
		const wrappedCb = (...cbArgs: unknown[]) => {
			const addr = original.address()
			if (addr && typeof addr === "object") {
				testContext.port = addr.port
			}
			if (typeof cb === "function") (cb as (...a: unknown[]) => void)(...cbArgs)
		}
		args[args.length - 1] = wrappedCb
		return origListen.apply(this, args as Parameters<typeof origListen>)
	} as typeof http.Server.prototype.listen

	const testContext: TestContext = { port: 0, state: "", loginPromise: undefined as unknown as ReturnType<typeof login> }

	const loginPromise = login({ timeout })
	testContext.loginPromise = loginPromise

	const deadline = Date.now() + timeout
	while (Date.now() < deadline && testContext.port === 0) {
		await new Promise((r) => setTimeout(r, 10))
	}

	http.createServer = origCreate
	http.Server.prototype.listen = origListen

	const logCalls = consoleLogCalls
	for (const log of logCalls) {
		const stateMatch = log.match(/state=([a-f0-9]+)/)
		if (stateMatch) {
			testContext.state = stateMatch[1]!
			break
		}
	}

	return testContext
}

let consoleLogCalls: string[] = []

async function hitCallback(port: number, path: string, method = "GET"): Promise<number> {
	if (port === 0) return 0
	return new Promise<number>((resolve) => {
		const req = http.request(
			{ hostname: "127.0.0.1", port, path, method },
			(res) => {
				res.on("data", () => {})
				res.on("end", () => resolve(res.statusCode ?? 0))
			},
		)
		req.on("error", () => resolve(0))
		req.setTimeout(300, () => {
			req.destroy()
			resolve(0)
		})
		req.end()
	})
}

async function waitForResult(loginPromise: ReturnType<typeof login>): Promise<Awaited<ReturnType<typeof login>>> {
	return loginPromise.catch((e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) }))
}

describe("OAuth callback security", () => {
	let logSpy: ReturnType<typeof vi.spyOn>
	let warnSpy: ReturnType<typeof vi.spyOn>
	let errorSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		mockSaveToken.mockClear()
		mockSaveToken.mockResolvedValue(undefined)
		consoleLogCalls = []
		logSpy = vi
			.spyOn(console, "log")
			.mockImplementation(((...args: unknown[]) => {
				consoleLogCalls.push(args.map(String).join(" "))
			}) as typeof console.log)
		warnSpy = vi.spyOn(console, "warn").mockImplementation((() => undefined) as typeof console.warn)
		errorSpy = vi.spyOn(console, "error").mockImplementation((() => undefined) as typeof console.error)
	})

	afterEach(() => {
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errorSpy.mockRestore()
	})

	it("rejects POST method on callback path", async () => {
		const ctx = await startLogin()
		const status = await hitCallback(ctx.port, "/callback", "POST")
		expect(status).toBe(405)
		await waitForResult(ctx.loginPromise)
	}, 10000)

	it("rejects unknown paths", async () => {
		const ctx = await startLogin()
		const status = await hitCallback(ctx.port, "/unknown")
		expect(status).toBe(404)
		await waitForResult(ctx.loginPromise)
	}, 10000)

	it("rejects URLs exceeding 4096 bytes", async () => {
		const ctx = await startLogin()
		const longUrl = "/callback?token=" + "a".repeat(5000)
		const status = await hitCallback(ctx.port, longUrl)
		expect(status).toBe(414)
		await waitForResult(ctx.loginPromise)
	}, 10000)

	it("rejects tokens exceeding 4096 bytes", async () => {
		const ctx = await startLogin()
		const longToken = "a".repeat(4097)
		const _status = await hitCallback(ctx.port, `/callback?token=${longToken}`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
	}, 10000)

	it("rejects non-JWT tokens (wrong segment count)", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?token=not-a-jwt&state=invalid`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Invalid token format")
		}
	}, 10000)

	it("rejects expired JWT tokens", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?token=${EXPIRED_TOKEN}&state=invalid`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("validation failed")
		}
	}, 10000)

	it("rejects callbacks with invalid state parameter", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?token=${VALID_TOKEN}&state=wrong-state`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Invalid state parameter")
		}
	}, 10000)

	it("rejects callbacks with missing token", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?state=anything`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Missing token")
		}
	}, 10000)

	it("rejects callbacks with error parameter", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?error=access_denied`)
		const result = await waitForResult(ctx.loginPromise)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("Authentication error")
		}
	}, 10000)

	it("accepts a valid callback with correct token and state", async () => {
		const ctx = await startLogin()
		const callbackUrl = `/callback?token=${VALID_TOKEN}&state=${ctx.state}`

		const firstStatus = await hitCallback(ctx.port, callbackUrl)
		const result = await waitForResult(ctx.loginPromise)

		expect(firstStatus).toBe(302)
		expect(result.success).toBe(true)
	}, 10000)

	it("does not log the token value", async () => {
		const ctx = await startLogin()
		await hitCallback(ctx.port, `/callback?token=${VALID_TOKEN}&state=${ctx.state}`)
		await waitForResult(ctx.loginPromise)

		const allLogs = [
			...logSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")),
			...warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")),
			...errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(" ")),
		]

		for (const logEntry of allLogs) {
			expect(logEntry).not.toContain(VALID_TOKEN)
		}
	}, 10000)

	it("times out and closes server when no callback arrives", async () => {
		const start = Date.now()
		const result = await login({ timeout: 500 })
		const elapsed = Date.now() - start

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain("timed out")
		}
		expect(elapsed).toBeLessThan(3000)
	}, 10000)
})
