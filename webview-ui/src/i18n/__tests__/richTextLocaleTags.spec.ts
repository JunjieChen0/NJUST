import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const TAG_TOKEN_REGEX = /<\/?\s*([A-Za-z][\w-]*|\d+)\s*>/g
const localesDir = join(process.cwd(), "src", "i18n", "locales")

const parseJson = (filePath: string): JsonValue => JSON.parse(readFileSync(filePath, "utf8")) as JsonValue

const getTagTokens = (value: string) =>
	Array.from(value.matchAll(TAG_TOKEN_REGEX), (match) => match[0].replace(/\s+/g, ""))

const hasRichTextTags = (value: string) => getTagTokens(value).length > 0

const isBalanced = (value: string) => {
	const stack: string[] = []

	for (const token of getTagTokens(value)) {
		const isClosingTag = token.startsWith("</")
		const tagName = token.replace(/<\/?|>/g, "")

		if (!isClosingTag) {
			stack.push(tagName)
			continue
		}

		if (stack.pop() !== tagName) {
			return false
		}
	}

	return stack.length === 0
}

const getNestedValue = (value: JsonValue, keyPath: string): JsonValue | undefined => {
	return keyPath.split(".").reduce<JsonValue | undefined>((current, segment) => {
		if (current && typeof current === "object" && !Array.isArray(current) && segment in current) {
			return current[segment]
		}

		return undefined
	}, value)
}

const collectRichTextKeys = (value: JsonValue, prefix = ""): string[] => {
	if (typeof value === "string") {
		return hasRichTextTags(value) ? [prefix] : []
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return []
	}

	return Object.entries(value).flatMap(([key, nestedValue]) =>
		collectRichTextKeys(nestedValue, prefix ? `${prefix}.${key}` : key),
	)
}

describe("locale rich-text tags", () => {
	const localeNames = readdirSync(localesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name !== "en")
		.sort()

	const fileNames = readdirSync(join(localesDir, "en"))
		.filter((fileName) => fileName.endsWith(".json"))
		.sort()

	for (const fileName of fileNames) {
		const englishFilePath = join(localesDir, "en", fileName)
		const englishData = parseJson(englishFilePath)
		const richTextKeys = collectRichTextKeys(englishData)

		if (richTextKeys.length === 0) {
			continue
		}

		it(`keeps balanced rich-text tags in en/${fileName}`, () => {
			const unbalancedKeys = richTextKeys.filter((keyPath) => {
				const value = getNestedValue(englishData, keyPath)
				return typeof value === "string" && !isBalanced(value)
			})

			expect(unbalancedKeys).toEqual([])
		})

		for (const localeName of localeNames) {
			it(`matches en rich-text tags for ${localeName}/${fileName}`, () => {
				const localeData = parseJson(join(localesDir, localeName, fileName))
				const mismatches: string[] = []

				for (const keyPath of richTextKeys) {
					const englishValue = getNestedValue(englishData, keyPath)
					const localeValue = getNestedValue(localeData, keyPath)

					if (typeof englishValue !== "string") {
						continue
					}

					if (typeof localeValue !== "string") {
						mismatches.push(`${keyPath}: missing or non-string value`)
						continue
					}

					if (!isBalanced(localeValue)) {
						mismatches.push(`${keyPath}: unbalanced tags`)
						continue
					}

					const englishTokens = getTagTokens(englishValue).toSorted()
					const localeTokens = getTagTokens(localeValue).toSorted()

					if (englishTokens.length !== localeTokens.length) {
						mismatches.push(`${keyPath}: expected ${englishTokens.join(", ")} but found ${localeTokens.join(", ")}`)
						continue
					}

					for (let index = 0; index < englishTokens.length; index++) {
						if (englishTokens[index] !== localeTokens[index]) {
							mismatches.push(
								`${keyPath}: expected ${englishTokens.join(", ")} but found ${localeTokens.join(", ")}`,
							)
							break
						}
					}
				}

				expect(mismatches).toEqual([])
			})
		}
	}
})
