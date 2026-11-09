import { describe, expect, it, vi, beforeEach } from "vitest"

const { guardedFetchMock } = vi.hoisted(() => ({ guardedFetchMock: vi.fn() }))

vi.mock("../../../core/security/networkGuard", () => ({
	guardedFetch: guardedFetchMock,
}))

vi.mock("../../../shared/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { ErrorReportingClient } from "../ErrorReportingClient"

const ENDPOINT = "https://reports.example.com/ingest"

describe("ErrorReportingClient", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts the event and allowlisted properties through guardedFetch", async () => {
		guardedFetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
		const client = new ErrorReportingClient(ENDPOINT)

		await client.captureEvent("exception", { error_type: "boom", event: "extension_init_error" })

		expect(guardedFetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = guardedFetchMock.mock.calls[0]!
		expect(url).toBe(ENDPOINT)
		expect(init.method).toBe("POST")
		const body = JSON.parse(init.body as string)
		expect(body.event).toBe("exception")
		expect(body.properties).toEqual({ error_type: "boom", event: "extension_init_error" })
		expect(typeof body.ts).toBe("number")
	})

	it("does not throw when the endpoint rejects the report", async () => {
		guardedFetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }))
		const client = new ErrorReportingClient(ENDPOINT)

		await expect(client.captureEvent("exception", {})).resolves.toBeUndefined()
	})

	it("swallows network failures so reporting never breaks the host", async () => {
		guardedFetchMock.mockRejectedValueOnce(new Error("SSRF blocked: private address"))
		const client = new ErrorReportingClient(ENDPOINT)

		await expect(client.captureEvent("exception", {})).resolves.toBeUndefined()
	})

	it("sends only the properties it is given, never ambient data", async () => {
		guardedFetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
		const client = new ErrorReportingClient(ENDPOINT)

		await client.captureEvent("task_created", { taskId: "task-1" })

		const body = JSON.parse(guardedFetchMock.mock.calls[0]![1].body as string)
		expect(Object.keys(body).sort()).toEqual(["event", "properties", "ts"])
		expect(body.properties).toEqual({ taskId: "task-1" })
	})
})
