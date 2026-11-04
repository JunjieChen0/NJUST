import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { GET } from "./route"

const mocks = vi.hoisted(() => ({
	listeners: new Map<string, Set<(data: string) => Promise<void>>>(),
	streams: [] as Array<{
		isClosed: boolean
		write: ReturnType<typeof vi.fn>
		close: ReturnType<typeof vi.fn>
		getResponse: () => Response
	}>,
}))
vi.mock("@njust-ai/evals", () => ({ findRun: async (id: number) => ({ id }) }))
vi.mock("@njust-ai/types", () => ({ taskEventSchema: { parse: (data: unknown) => data } }))
vi.mock("@/lib/server/admin-auth", () => ({ requireAdminForRequest: async () => undefined }))
vi.mock("@/lib/server/origin-check", () => ({ validateOrigin: () => true }))
vi.mock("@/lib/server/validation", () => ({ validateRunId: (id: string) => Number(id) }))
vi.mock("@/lib/server/redis", () => ({
	redisClient: async () => ({
		subscribe: async (channel: string, listener: (data: string) => Promise<void>) => {
			const listeners = mocks.listeners.get(channel) ?? new Set()
			listeners.add(listener)
			mocks.listeners.set(channel, listeners)
		},
		unsubscribe: async (channel: string, listener?: (data: string) => Promise<void>) => {
			if (listener) mocks.listeners.get(channel)?.delete(listener)
			else mocks.listeners.delete(channel)
		},
	}),
}))
vi.mock("@/lib/server/sse-stream", () => ({
	SSEStream: class {
		isClosed = false
		write = vi.fn(async () => true)
		close = vi.fn(async () => {
			this.isClosed = true
		})
		getResponse = () => new Response()
		constructor() {
			mocks.streams.push(this)
		}
	},
}))

describe("SSE viewer subscriptions", () => {
	beforeEach(() => {
		mocks.listeners.clear()
		mocks.streams.length = 0
	})
	it("disconnects only the departing viewer of the same run", async () => {
		const controllers = [new AbortController(), new AbortController()] as const
		for (const controller of controllers)
			await GET({ signal: controller.signal } as NextRequest, { params: Promise.resolve({ id: "1" }) })
		controllers[0].abort()
		await vi.waitFor(() => expect(mocks.streams[0]!.isClosed).toBe(true))
		for (const listener of mocks.listeners.get("evals:1") ?? []) await listener('{"eventName":"taskCompleted"}')
		expect(mocks.streams[1]!.write).toHaveBeenCalledOnce()
		expect(mocks.streams[1]!.isClosed).toBe(false)
		expect(mocks.listeners.get("evals:1")?.size).toBe(1)
		controllers[1].abort()
		await vi.waitFor(() => expect(mocks.streams[1]!.isClosed).toBe(true))
	})
})
