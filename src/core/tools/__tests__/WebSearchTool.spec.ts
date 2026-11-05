import { beforeEach, describe, expect, it, vi } from "vitest"

const { createSearchProviderMock, formatSearchResultsMock, searchProviderSearchMock } = vi.hoisted(() => ({
	createSearchProviderMock: vi.fn(),
	formatSearchResultsMock: vi.fn(),
	searchProviderSearchMock: vi.fn(),
}))

vi.mock("../../../services/web-search/WebSearchProvider", () => ({
	createSearchProvider: createSearchProviderMock,
	formatSearchResults: formatSearchResultsMock,
	getSearchProviderInfo: () => ({
		"baidu-free": { label: "Baidu (Free)", keyHint: "No key needed", noKey: true },
		serpapi: { label: "SerpAPI", keyHint: "Get from serpapi.com", noKey: false },
		tavily: { label: "Tavily", keyHint: "Get from tavily.com", noKey: false },
		bing: { label: "Bing (retired)", keyHint: "Bing Search API was retired on 2025-08-11" },
	}),
}))

import { webSearchTool } from "../WebSearchTool"

function createTask(overrides: Record<string, unknown> = {}) {
	const provider = {
		getState: vi.fn().mockResolvedValue({
			enableWebSearch: true,
			webSearchApiKey: "test-api-key",
			webSearchProvider: "serpapi",
			serpApiEngine: "bing",
		}),
	}
	return {
		cwd: "/workspace",
		providerRef: { deref: () => provider },
		...overrides,
	} as any
}

function createCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		reportProgress: vi.fn(),
	}
}

describe("WebSearchTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		searchProviderSearchMock.mockResolvedValue([
			{ title: "Result 1", url: "https://example.com/1", snippet: "First result" },
		])
		createSearchProviderMock.mockReturnValue({
			search: searchProviderSearchMock,
		})
		formatSearchResultsMock.mockReturnValue("Formatted: Result 1 - https://example.com/1")
	})

	describe("metadata", () => {
		it("is concurrency safe", () => {
			expect(webSearchTool.isConcurrencySafe()).toBe(true)
		})

		it("is eager execution", () => {
			expect(webSearchTool.getEagerExecutionDecision()).toBe("eager")
		})

		it("has stable partial args when search_query is non-empty", () => {
			expect(webSearchTool.isPartialArgsStable({ search_query: "test" })).toBe(true)
			expect(webSearchTool.isPartialArgsStable({ search_query: "" })).toBe(false)
			expect(webSearchTool.isPartialArgsStable({})).toBe(false)
		})
	})

	describe("execute", () => {
		it("does not approve or execute a search when web search is disabled", async () => {
			const task = createTask()
			task.providerRef.deref().getState.mockResolvedValue({ enableWebSearch: false })
			const callbacks = createCallbacks()
			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)
			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(searchProviderSearchMock).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("disabled"), {
				isError: true,
			})
		})

		it("rechecks the switch after approval", async () => {
			const task = createTask()
			const callbacks = createCallbacks()
			callbacks.askApproval.mockImplementation(async () => {
				task.providerRef.deref().getState.mockResolvedValue({ enableWebSearch: false })
				return true
			})
			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)
			expect(searchProviderSearchMock).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("disabled"), {
				isError: true,
			})
		})

		it("cancels an active search through the task signal", async () => {
			const controller = new AbortController()
			const task = createTask({ toolAbortController: controller })
			searchProviderSearchMock.mockImplementation(
				async (_query, _count, signal: AbortSignal) =>
					new Promise((_resolve, reject) =>
						signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
					),
			)
			const callbacks = createCallbacks()
			const pending = webSearchTool.execute({ search_query: "test" }, task, callbacks as any)
			await vi.waitFor(() => expect(searchProviderSearchMock).toHaveBeenCalledTimes(1))
			controller.abort()
			await pending
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("Web search was cancelled.", { isError: true })
			expect(formatSearchResultsMock).not.toHaveBeenCalled()
		})

		it("does not search when a parallel batch has already been cancelled", async () => {
			const controller = new AbortController()
			controller.abort()
			const callbacks = { ...createCallbacks(), abortSignal: controller.signal }
			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)
			expect(searchProviderSearchMock).not.toHaveBeenCalled()
			expect(callbacks.askApproval).not.toHaveBeenCalled()
		})

		it("explains retired Bing configuration without asking for an obsolete key", async () => {
			const task = createTask()
			task.providerRef.deref().getState.mockResolvedValue({ enableWebSearch: true, webSearchProvider: "bing" })
			const callbacks = createCallbacks()
			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("retired"), { isError: true })
			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(createSearchProviderMock).not.toHaveBeenCalled()
		})

		it("returns error when API key is not configured", async () => {
			const provider = {
				getState: vi.fn().mockResolvedValue({
					enableWebSearch: true,
					webSearchApiKey: "",
					webSearchProvider: "serpapi",
					serpApiEngine: "bing",
				}),
			}
			const task = createTask({ providerRef: { deref: () => provider } })
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("API key is not configured"))
		})

		it("skips API key check for no-key providers", async () => {
			const provider = {
				getState: vi.fn().mockResolvedValue({
					enableWebSearch: true,
					webSearchApiKey: "",
					webSearchProvider: "baidu-free",
					serpApiEngine: "bing",
				}),
			}
			const task = createTask({ providerRef: { deref: () => provider } })
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)

			expect(callbacks.pushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("API key"))
			expect(createSearchProviderMock).toHaveBeenCalled()
		})

		it("does not search when approval is denied", async () => {
			const callbacks = createCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)

			expect(searchProviderSearchMock).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("not approved"))
		})

		it("performs search and formats results", async () => {
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "vitest mocking" }, createTask(), callbacks as any)

			expect(createSearchProviderMock).toHaveBeenCalledWith("serpapi", "test-api-key", "bing")
			expect(searchProviderSearchMock).toHaveBeenCalledWith("vitest mocking", 5, undefined)
			expect(formatSearchResultsMock).toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("Formatted: Result 1 - https://example.com/1")
		})

		it("uses custom count when provided", async () => {
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test", count: 10 }, createTask(), callbacks as any)

			expect(searchProviderSearchMock).toHaveBeenCalledWith("test", 10, undefined)
		})

		it("defaults count to 5 when not provided", async () => {
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)

			expect(searchProviderSearchMock).toHaveBeenCalledWith("test", 5, undefined)
		})

		it("reports progress during execution", async () => {
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)

			expect(callbacks.reportProgress).toHaveBeenCalledWith(
				expect.objectContaining({ text: "Validating web search request" }),
			)
			expect(callbacks.reportProgress).toHaveBeenCalledWith(
				expect.objectContaining({ text: "Executing web search" }),
			)
		})

		it("delegates search errors to handleError", async () => {
			searchProviderSearchMock.mockRejectedValue(new Error("rate limit exceeded"))
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"web search",
				expect.objectContaining({ message: "rate limit exceeded" }),
			)
		})

		it("wraps non-Error throws in handleError", async () => {
			searchProviderSearchMock.mockRejectedValue("string error")
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith("web search", expect.any(Error))
		})

		it("returns error when provider reference is lost", async () => {
			const task = createTask({
				providerRef: { deref: () => undefined },
			})
			const callbacks = createCallbacks()

			await webSearchTool.execute({ search_query: "test" }, task, callbacks as any)

			// When provider is undefined, getState won't be called,
			// apiKey will be undefined, and it should report missing key
			expect(callbacks.pushToolResult).toHaveBeenCalled()
		})
	})
})
