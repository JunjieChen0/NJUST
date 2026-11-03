import { describe, expect, it } from "vitest"
import { OpenAiCodexHandler } from "../openai-codex"
import { VertexHandler } from "../vertex"
import { AwsBedrockHandler } from "../bedrock"
import { LiteLLMHandler } from "../lite-llm"
import { OpenAiNativeHandler } from "../openai-native"

describe("custom model IDs remain explicit", () => {
	it.each([
		() => new OpenAiCodexHandler({ apiModelId: "new-model-id" }),
		() =>
			new VertexHandler({ apiModelId: "new-model-id", vertexProjectId: "fixture", vertexRegion: "us-central1" }),
		() => new AwsBedrockHandler({ apiModelId: "new-model-id", awsRegion: "us-east-1" }),
		() =>
			new LiteLLMHandler({
				litellmModelId: "new-model-id",
				litellmApiKey: "fixture",
				litellmBaseUrl: "https://fixture.invalid",
			}),
	])("does not silently use a different model", (create) => {
		expect(create().getModel().id).toBe("new-model-id")
	})
	it("does not rewrite a newly discovered o3-mini snapshot as a legacy alias", () => {
		const model = new OpenAiNativeHandler({
			apiModelId: "o3-mini-new-snapshot",
			openAiNativeApiKey: "fixture",
		}).getModel()
		expect(model.id).toBe("o3-mini-new-snapshot")
	})
})
