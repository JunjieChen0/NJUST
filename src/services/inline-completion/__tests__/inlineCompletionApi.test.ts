import { afterEach, describe, expect, it, vi } from "vitest"
import { buildApiHandler } from "../../../api"
import { resolveInlineCompletionApiHandler } from "../inlineCompletionApi"
import { createMockClineProvider, createMockTask } from "../../../__tests__/helpers/vscodeMocks"

vi.mock("../../../api", () => ({ buildApiHandler: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe("inline completion model preparation", () => {
	it("uses the task profile without sharing its live stream handler", async () => {
		const prepareModel = vi.fn().mockResolvedValue(undefined)
		const independent: ReturnType<typeof buildApiHandler> = {
			prepareModel,
			createMessage: vi.fn(),
			getModel: vi.fn(),
			countTokens: vi.fn(),
		}
		vi.mocked(buildApiHandler).mockReturnValue(independent)
		const profile = { apiProvider: "openai-native", openAiNativeApiKey: "fixture", apiModelId: "new-model" }
		const liveApi = {}
		const getState = vi.fn()
		const provider = createMockClineProvider({
			getCurrentTask: () => createMockTask({ api: liveApi, apiConfiguration: profile }),
			getState,
		})
		expect(await resolveInlineCompletionApiHandler(provider)).toBe(independent)
		expect(buildApiHandler).toHaveBeenCalledWith(profile, undefined, expect.any(Object))
		expect(prepareModel).toHaveBeenCalledTimes(1)
		expect(getState).not.toHaveBeenCalled()
	})
	it("prepares the saved profile before exposing a new handler", async () => {
		let release!: () => void
		const prepareModel = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const independent: ReturnType<typeof buildApiHandler> = {
			prepareModel,
			createMessage: vi.fn(),
			getModel: vi.fn(),
			countTokens: vi.fn(),
		}
		vi.mocked(buildApiHandler).mockReturnValue(independent)
		const provider = createMockClineProvider({
			getCurrentTask: () => undefined,
			getState: async () => ({ apiConfiguration: { apiProvider: "qwen", qwenApiKey: "fixture" } }),
		})
		let ready = false
		const pending = resolveInlineCompletionApiHandler(provider).then((api) => {
			ready = true
			return api
		})
		await vi.waitFor(() => expect(prepareModel).toHaveBeenCalledTimes(1))
		expect(ready).toBe(false)
		release()
		expect(await pending).toBe(independent)
	})
})
