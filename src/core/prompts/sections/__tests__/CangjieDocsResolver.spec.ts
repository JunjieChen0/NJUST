import { beforeEach, describe, expect, it, vi } from "vitest"

const corpusPathMock = vi.hoisted(() => vi.fn())

vi.mock("../../../../utils/bundledCangjieCorpus", () => ({
	getBundledCangjieCorpusPath: corpusPathMock,
}))

import { resolveBundledCangjieCorpusPath, resolveCangjieDocsBasePath } from "../CangjieDocsResolver"

describe("CangjieDocsResolver", () => {
	beforeEach(() => {
		corpusPathMock.mockReset()
	})

	it("resolves the bundled corpus path", () => {
		corpusPathMock.mockReturnValue("C:/ext/resources/cangjie")

		expect(resolveBundledCangjieCorpusPath("C:/ext")).toBe("C:/ext/resources/cangjie")
		expect(corpusPathMock).toHaveBeenCalledWith("C:/ext")
	})

	it("uses the bundled corpus as the docs base", () => {
		corpusPathMock.mockReturnValue(null)

		expect(resolveCangjieDocsBasePath("C:/missing")).toBeNull()
		expect(corpusPathMock).toHaveBeenCalledWith("C:/missing")
	})
})
