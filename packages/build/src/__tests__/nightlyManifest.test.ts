import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { generatePackageJson } from "../esbuild.js"

const source = JSON.parse(readFileSync(new URL("../../../../src/package.json", import.meta.url), "utf8"))
const override = JSON.parse(
	readFileSync(new URL("../../../../apps/vscode-nightly/package.nightly.json", import.meta.url), "utf8"),
)
const generated = generatePackageJson({
	packageJson: source,
	overrideJson: override,
	substitution: ["njust-ai", "njust-ai-nightly"],
})

describe("Nightly manifest from the real extension", () => {
	it("uses the same NJUST crest as the standard extension", () => {
		expect(generated.icon).toBe(source.icon)
	})

	it("retains every contribution point", () => {
		expect(Object.keys(generated.contributes).sort()).toEqual(Object.keys(source.contributes).sort())
	})

	it.each([
		"debuggers",
		"languages",
		"grammars",
		"snippets",
		"taskDefinitions",
		"problemMatchers",
		"languageModelTools",
		"chatParticipants",
	])("preserves %s without changing runtime identifiers", (key) => {
		expect(generated.contributes[key]).toEqual(source.contributes[key])
	})

	it("still renames commands, views and configuration for Nightly", () => {
		expect(generated.name).toBe("njust-ai-nightly")
		expect(generated.contributes.commands).toContainEqual(
			expect.objectContaining({ command: "njust-ai-nightly.settingsButtonClicked" }),
		)
		expect(generated.contributes.views).toHaveProperty("njust-ai-nightly-ActivityBar")
		expect(generated.contributes.configuration).toHaveProperty(["properties", "njust-ai-nightly.allowedCommands"])
	})
})
