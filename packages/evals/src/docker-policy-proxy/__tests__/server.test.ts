/**
 * Docker Policy Proxy — Server Integration Tests
 *
 * Tests proxy-level behavior: auth enforcement, fail-closed,
 * body size limits, container name requirements, method enforcement.
 * Uses a real HTTP server (no Docker daemon needed — requests are
 * validated before forwarding, so we test the validation layer).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as http from "http"

import { DockerPolicyProxy } from "../server"
import { DEFAULT_POLICY } from "../policy"

const TEST_TOKEN = "test-auth-token-12345"

function httpRequest(
	port: number,
	method: string,
	path: string,
	headers: Record<string, string> = {},
	body?: string,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: "127.0.0.1", port, method, path, headers: { ...headers } },
			(res) => {
				const chunks: Buffer[] = []
				res.on("data", (c: Buffer) => chunks.push(c))
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
			},
		)
		req.on("error", reject)
		if (body) req.write(body)
		req.end()
	})
}

describe("Docker Policy Proxy — Server Integration", () => {
	let proxy: DockerPolicyProxy
	let port: number

	beforeEach(async () => {
		proxy = new DockerPolicyProxy({
			port: 0,
			bindAddress: "127.0.0.1",
			dockerEndpoint: "unix:///tmp/fake-docker.sock",
			policy: DEFAULT_POLICY,
			authToken: TEST_TOKEN,
		})
		await proxy.start()
		const addr = (proxy as unknown as { httpServer: { address: () => import("net").AddressInfo | string | null } }).httpServer?.address()
		port = typeof addr === "object" && addr !== null && "port" in addr ? addr.port : 0
	})

	afterEach(async () => {
		await proxy.stop()
	})

	describe("Authentication", () => {
		it("rejects requests without Authorization header", async () => {
			const resp = await httpRequest(port, "GET", "/_ping")
			expect(resp.status).toBe(401)
			expect(JSON.parse(resp.body).message).toContain("Unauthorized")
		})

		it("rejects requests with wrong Bearer token", async () => {
			const resp = await httpRequest(port, "GET", "/_ping", { authorization: "Bearer wrong-token" })
			expect(resp.status).toBe(401)
		})

		it("rejects requests with non-Bearer auth scheme", async () => {
			const resp = await httpRequest(port, "GET", "/_ping", { authorization: `Basic ${TEST_TOKEN}` })
			expect(resp.status).toBe(401)
		})

		it("accepts requests with correct Bearer token", async () => {
			// /_ping is allowed but will fail to forward (no Docker daemon)
			// We just verify auth passes (will get 502 from forwarding, not 401)
			const resp = await httpRequest(port, "GET", "/_ping", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).not.toBe(401)
		})
	})

	describe("Fail-closed startup", () => {
		it("throws when authToken is empty string", async () => {
			const badProxy = new DockerPolicyProxy({
				port: 0,
				bindAddress: "127.0.0.1",
				dockerEndpoint: "unix:///tmp/fake.sock",
				policy: DEFAULT_POLICY,
				authToken: "",
			})
			await expect(badProxy.start()).rejects.toThrow("PROXY_AUTH_TOKEN is required")
		})
	})

	describe("Method/Path enforcement", () => {
		it("rejects image operations", async () => {
			const resp = await httpRequest(port, "POST", "/images/create", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).toBe(403)
			expect(JSON.parse(resp.body).message).toContain("not allowed")
		})

		it("rejects network operations", async () => {
			const resp = await httpRequest(port, "POST", "/networks/create", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).toBe(403)
		})

		it("rejects volume operations", async () => {
			const resp = await httpRequest(port, "POST", "/volumes/create", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).toBe(403)
		})

		it("rejects swarm operations", async () => {
			const resp = await httpRequest(port, "POST", "/swarm/init", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).toBe(403)
		})

		it("allows /version endpoint", async () => {
			const resp = await httpRequest(port, "GET", "/version", { authorization: `Bearer ${TEST_TOKEN}` })
			expect(resp.status).not.toBe(403)
		})
	})

	describe("Container name enforcement", () => {
		it("rejects container creation without name", async () => {
			const body = JSON.stringify({ Image: "evals-runner", Env: [] })
			const resp = await httpRequest(port, "POST", "/containers/create", {
				authorization: `Bearer ${TEST_TOKEN}`,
				"content-type": "application/json",
			}, body)
			expect(resp.status).toBe(403)
			expect(JSON.parse(resp.body).message).toContain("Container name is required")
		})

		it("rejects container creation with wrong prefix", async () => {
			const body = JSON.stringify({ Image: "evals-runner", Env: [] })
			const resp = await httpRequest(port, "POST", "/containers/create?name=evil-container", {
				authorization: `Bearer ${TEST_TOKEN}`,
				"content-type": "application/json",
			}, body)
			expect(resp.status).toBe(403)
			expect(JSON.parse(resp.body).message).toContain("must start with")
		})

		it("rejects container creation without body", async () => {
			const resp = await httpRequest(port, "POST", "/containers/create?name=evals-test", {
				authorization: `Bearer ${TEST_TOKEN}`,
			})
			expect(resp.status).toBe(403)
			expect(JSON.parse(resp.body).message).toContain("requires a JSON body")
		})

		it("allows container creation with valid name and image", async () => {
			const body = JSON.stringify({ Image: "evals-runner", Env: [], HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200, NanoCpus: 1e9, NetworkMode: "evals_default" } })
			const resp = await httpRequest(port, "POST", "/containers/create?name=evals-test-1", {
				authorization: `Bearer ${TEST_TOKEN}`,
				"content-type": "application/json",
			}, body)
			// Will fail to forward (no Docker daemon), but policy passes
			expect(resp.status).not.toBe(403)
		})
	})

	describe("Body size limit", () => {
		it("rejects bodies exceeding 10MB", async () => {
			// Create a body larger than MAX_BODY_SIZE (10MB)
			const largeBody = "x".repeat(11 * 1024 * 1024)
			// The server destroys the connection when body exceeds limit,
			// so we expect either an HTTP error response or a connection reset.
			try {
				const resp = await httpRequest(port, "POST", "/containers/create?name=evals-test", {
					authorization: `Bearer ${TEST_TOKEN}`,
					"content-type": "application/json",
					"content-length": String(largeBody.length),
				}, largeBody)
				// If we get a response, it should be an error
				expect(resp.status).toBeGreaterThanOrEqual(400)
			} catch (err: unknown) {
				// ECONNRESET is expected — server destroyed the socket
				expect((err as { code?: string }).code).toBe("ECONNRESET")
			}
		})
	})
})
