import dns from "node:dns/promises"
import type { LookupAddress, LookupAllOptions } from "node:dns"
import tls from "node:tls"
import https from "node:https"
import http from "node:http"
import net from "node:net"
import type { Duplex } from "node:stream"
import { execFileSync } from "node:child_process"
import { createPrivateKey } from "node:crypto"
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { guardedFetch, setGuardedFetchProxy } from "../networkGuard.js"

// Spy on the overload used by the guard, which always requests all addresses.
const mockLookup = () =>
	vi.spyOn(dns, "lookup") as MockInstance<(host: string, options: LookupAllOptions) => Promise<LookupAddress[]>>

describe("guardedFetch DNS pinning", () => {
	afterEach(() => {
		setGuardedFetchProxy(undefined)
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it("keeps the TLS hostname and pins connections to the validated address", async () => {
		mockLookup().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
		const fetch = vi.fn(
			async (
				url: string | URL | Request,
				init?: RequestInit & { dispatcher?: { dispatch: (options: unknown, handler: unknown) => boolean } },
			) => {
				expect(String(url)).toBe("https://example.com:8443/api")
				expect(init?.redirect).toBe("manual")
				expect(init?.dispatcher).toBeDefined()
				return new Response("ok")
			},
		)
		vi.stubGlobal("fetch", fetch)
		await guardedFetch("https://example.com:8443/api")
		expect(fetch).toHaveBeenCalledOnce()
	})

	it("preserves TLS SNI and only connects to the already validated IP", async () => {
		const lookup = mockLookup().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
		const connect = vi.spyOn(tls, "connect").mockImplementation(() => {
			throw new Error("TLS intercepted before network I/O")
		})
		await expect(guardedFetch("https://example.com/api")).rejects.toThrow("fetch failed")
		const options = connect.mock.calls[0]![0] as tls.ConnectionOptions
		expect(options.servername).toBe("example.com")
		const callback = vi.fn()
		options.lookup!("example.com", {}, callback)
		expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4)
		options.lookup!("example.com", { all: true }, callback)
		expect(callback).toHaveBeenLastCalledWith(null, [{ address: "93.184.216.34", family: 4 }])
		expect(lookup).toHaveBeenCalledTimes(2)
	})

	it("does not expose API keys or search text in redirect-limit errors", async () => {
		mockLookup().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
		const transport = vi.fn(
			async () =>
				new Response("redirect", {
					status: 302,
					headers: { Location: "/search?api_key=dummy-key&q=private-search-text" },
				}),
		)
		vi.stubGlobal("fetch", transport)
		const failure = await guardedFetch("https://example.com/search?api_key=dummy-key&q=private-search-text").catch(
			(error: unknown) => error,
		)
		expect(failure).toBeInstanceOf(Error)
		expect((failure as Error).message).toContain("Too many redirects")
		expect((failure as Error).stack).not.toContain("dummy-key")
		expect((failure as Error).stack).not.toContain("private-search-text")
		expect(transport).toHaveBeenCalledTimes(6)
	})

	it.each([false, true])("rejects DNS rebinding before a request (proxy=%s)", async (proxy) => {
		if (proxy) setGuardedFetchProxy({ serverUrl: "http://127.0.0.1:8888", tlsInsecure: false })
		const lookup = mockLookup()
		lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
		lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
		const fetch = vi.fn()
		vi.stubGlobal("fetch", fetch)
		await expect(guardedFetch("https://example.com/api")).rejects.toThrow("Blocked private")
		expect(fetch).not.toHaveBeenCalled()
	})

	it("validates a trusted DNS-only certificate over a real local TLS connection", async () => {
		// Generate credentials in memory; no key or certificate is written to disk.
		const pem = execFileSync(
			"openssl",
			[
				"req",
				"-config",
				process.platform === "win32" ? "NUL" : "/dev/null",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				"-",
				"-out",
				"-",
				"-days",
				"1",
				"-subj",
				"/CN=example.com",
				"-addext",
				"subjectAltName=DNS:example.com",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		)
		const key = createPrivateKey(pem).export({ type: "pkcs8", format: "pem" })
		const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0]
		const hosts: string[] = []
		const server = https.createServer({ key, cert }, (req, res) => {
			hosts.push(req.headers.host ?? "")
			if (req.url === "/stream") res.write("partial response")
			else res.end("verified TLS")
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		const address = server.address() as { port: number }
		const tunnels: string[] = []
		const sockets = new Set<Duplex>()
		const proxy = http.createServer()
		proxy.on("connect", (req, socket, head) => {
			tunnels.push(req.url ?? "")
			expect(req.headers.host).toBe(req.url)
			expect(req.headers["proxy-authorization"]).toBe(
				`Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
			)
			const upstream = net.connect(address.port, "127.0.0.1", () => {
				socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
				if (head.length) upstream.write(head)
				socket.pipe(upstream).pipe(socket)
			})
			sockets.add(socket)
			sockets.add(upstream)
			socket.on("error", () => upstream.destroy())
			upstream.on("error", () => socket.destroy())
		})
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
		const proxyPort = (proxy.address() as { port: number }).port
		mockLookup().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
		const connect = tls.connect.bind(tls)
		// Route only this test's socket to the loopback server while preserving TLS verification.
		vi.spyOn(tls, "connect").mockImplementation(((options: tls.ConnectionOptions, callback?: () => void) =>
			connect({ ...options, host: "127.0.0.1", ca: cert }, callback)) as typeof tls.connect)
		try {
			const response = await guardedFetch(`https://example.com:${address.port}/api`)
			expect(await response.text()).toBe("verified TLS")
			expect(hosts).toEqual([`example.com:${address.port}`])
			await expect(guardedFetch(`https://wrong.example.com:${address.port}/api`)).rejects.toThrow("fetch failed")
			const controller = new AbortController()
			const streaming = await guardedFetch(`https://example.com:${address.port}/stream`, {
				signal: controller.signal,
			})
			controller.abort()
			await expect(streaming.text()).rejects.toMatchObject({ name: "AbortError" })

			setGuardedFetchProxy({
				serverUrl: `http://test-user:test-password@127.0.0.1:${proxyPort}`,
				tlsInsecure: false,
			})
			const proxied = await guardedFetch(`https://example.com:${address.port}/api`)
			expect(await proxied.text()).toBe("verified TLS")
			expect(tunnels).toEqual([`93.184.216.34:${address.port}`])
			expect(hosts.at(-1)).toBe(`example.com:${address.port}`)
			const defaultPort = await guardedFetch("https://example.com/api")
			expect(await defaultPort.text()).toBe("verified TLS")
			expect(tunnels.at(-1)).toBe("93.184.216.34:443")
			expect(hosts.at(-1)).toBe("example.com")
			await expect(guardedFetch(`https://wrong.example.com:${address.port}/api`)).rejects.toThrow("fetch failed")
			const abortProxy = new AbortController()
			const proxyStream = await guardedFetch(`https://example.com:${address.port}/stream`, {
				signal: abortProxy.signal,
			})
			abortProxy.abort()
			await expect(proxyStream.text()).rejects.toMatchObject({ name: "AbortError" })
			for (const host of ["93.184.216.34", "[2606:4700:4700::1111]"]) {
				await expect(guardedFetch(`https://${host}/api`)).rejects.toThrow("fetch failed")
				expect(tunnels.at(-1)).toBe(`${host}:443`)
			}
			setGuardedFetchProxy(undefined)
			const direct = await guardedFetch(`https://example.com:${address.port}/api`)
			expect(await direct.text()).toBe("verified TLS")
			expect(tunnels).toHaveLength(6)
		} finally {
			for (const socket of sockets) socket.destroy()
			await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())))
			server.closeAllConnections()
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		}
	})
})
