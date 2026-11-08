import { afterEach, expect, it, vi } from "vitest"
import { assertPublicIp, assertSafeOutboundUrl, guardedFetch } from "../networkGuard.js"

const lookup = vi.hoisted(() => vi.fn<() => Promise<{ address: string; family: number }[]>>())
vi.mock("node:dns/promises", () => ({ default: { lookup } }))
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.resetAllMocks()
})
const addresses = [{ address: "8.8.8.8", family: 4 }]
it.each([1, 2, 3])("cancels DNS stage %s without waiting for resolution or starting later requests", async (stage) => {
	vi.useFakeTimers()
	let release!: (value: typeof addresses) => void
	let calls = 0
	lookup.mockImplementation(async () =>
		++calls === stage
			? new Promise<typeof addresses>((resolve) => {
					release = resolve
				})
			: addresses,
	)
	const fetch = vi.fn(
		async () => new Response("", { status: 302, headers: { location: "https://probe.example/next" } }),
	)
	vi.stubGlobal("fetch", fetch)
	const controller = new AbortController()
	const settled = vi.fn()
	const pending = guardedFetch("https://probe.example/", { signal: controller.signal })
	void pending.then(settled, settled)
	await vi.advanceTimersByTimeAsync(0)
	expect(calls).toBe(stage)
	controller.abort()
	await vi.advanceTimersByTimeAsync(1)
	expect(settled).toHaveBeenCalledOnce()
	const before = fetch.mock.calls.length
	release(addresses)
	await expect(pending).rejects.toMatchObject({ name: "AbortError" })
	await vi.advanceTimersByTimeAsync(1)
	expect(fetch).toHaveBeenCalledTimes(before)
})
it("does not start DNS for an already cancelled request", async () => {
	await expect(guardedFetch("https://probe.example/", { signal: AbortSignal.abort() })).rejects.toMatchObject({
		name: "AbortError",
	})
	expect(lookup).not.toHaveBeenCalled()
})
it("honors the caller's total timeout while DNS is unresolved", async () => {
	lookup.mockImplementationOnce(() => new Promise(() => {}))
	const fetch = vi.fn()
	vi.stubGlobal("fetch", fetch)
	await expect(guardedFetch("https://probe.example/", { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({
		name: "TimeoutError",
	})
	expect(lookup).toHaveBeenCalledOnce()
	expect(fetch).not.toHaveBeenCalled()
})
it("accepts a public IPv6 literal without DNS", async () => {
	await expect(assertSafeOutboundUrl("https://[2606:4700:4700::1111]/")).resolves.toBeInstanceOf(URL)
	expect(lookup).not.toHaveBeenCalled()
})
it.each(["fe90::1", "febf::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "0:0:0:0:0:ffff:c0a8:101"])(
	"blocks non-public IPv6 %s",
	(ip) => {
		expect(() => assertPublicIp(ip)).toThrow()
	},
)
it.each(["2606:4700:4700::1111", "::ffff:808:808"])("preserves public IPv6 %s", (ip) => {
	expect(() => assertPublicIp(ip)).not.toThrow()
})
