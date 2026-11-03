import { describe, expect, it } from "vitest"
import { mergeCatalogModelInfo, type ModelInfo } from "../model.js"

const partialModel: ModelInfo = {
	contextWindow: 64000,
	supportsPromptCache: false,
	estimatedFields: ["maxTokens", "supportsPromptCache"],
}

describe("model metadata provenance", () => {
	it("preserves missing-field estimates when a discovered model is merged again", () => {
		const discovered = mergeCatalogModelInfo(undefined, partialModel)
		const snapshot = mergeCatalogModelInfo(discovered, partialModel)
		expect(snapshot.estimatedFields).toEqual(["maxTokens", "supportsPromptCache"])
		expect(snapshot.pricingUnknown).toBe(true)
	})
	it("removes an estimate when the API supplies that field", () => {
		const discovered = mergeCatalogModelInfo(undefined, partialModel)
		const updated = mergeCatalogModelInfo(discovered, {
			contextWindow: 64000,
			maxTokens: 8192,
			supportsPromptCache: true,
		})
		expect(updated).toMatchObject({ maxTokens: 8192, supportsPromptCache: true, estimatedFields: [] })
	})
	it("retains exact curated facts when listing supplies only estimated placeholders", () => {
		const curated: ModelInfo = {
			contextWindow: 128000,
			maxTokens: 8192,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
		}
		const merged = mergeCatalogModelInfo(curated, {
			...partialModel,
			estimatedFields: ["contextWindow", "maxTokens", "supportsPromptCache"],
		})
		expect(merged).toMatchObject({ ...curated, pricingUnknown: false, estimatedFields: [] })
	})
})
