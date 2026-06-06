import { describe, it, expect } from "vitest"
import { sanitizeXmlToolCalls, parseXmlToolCalls } from "../sanitizeXmlToolCalls"

// Build XML-like strings using String.fromCharCode to avoid angle bracket
// issues with test tooling.
const LT = String.fromCharCode(60) // <
const GT = String.fromCharCode(62) // >

function tag(name: string, closing = false, attrs = ""): string {
	const slash = closing ? "/" : ""
	const attr = attrs ? " " + attrs : ""
	return LT + slash + name + attr + GT
}

function xmlToolCallBlock(body: string): string {
	return tag("tool_call") + "\n" + body + "\n" + tag("tool_call", true)
}

function functionTag(name: string, closing = false): string {
	if (closing) return LT + "/function" + GT
	return LT + "function=" + name + GT
}

function parameterTag(name: string, closing = false): string {
	if (closing) return LT + "/parameter" + GT
	return LT + "parameter=" + name + GT
}

function parameterTagQuoted(name: string, closing = false): string {
	if (closing) return LT + "/parameter" + GT
	return LT + 'parameter="' + name + '"' + GT
}

describe("sanitizeXmlToolCalls", () => {
	it("should return unchanged content when no XML tool calls are present", () => {
		const content = "Hello world, this is a normal message."
		const result = sanitizeXmlToolCalls(content)
		expect(result.content).toBe(content)
		expect(result.hadXmlToolCalls).toBe(false)
	})

	it("should handle empty and null content", () => {
		expect(sanitizeXmlToolCalls("").content).toBe("")
		expect(sanitizeXmlToolCalls("").hadXmlToolCalls).toBe(false)
	})

	it("should strip complete tool_call blocks", () => {
		const body =
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"cjpm --version" +
			parameterTag("command", true) +
			"\n" +
			parameterTag("cwd") +
			"d:/test" +
			parameterTag("cwd", true) +
			"\n" +
			functionTag("execute_command", true)
		const fullBlock = xmlToolCallBlock(body)
		const content = "Some text before\n" + fullBlock + "\nSome text after"

		const result = sanitizeXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.content).toContain("Some text before")
		expect(result.content).toContain("Some text after")
		expect(result.content).not.toContain("tool_call")
		expect(result.content).not.toContain("function=")
		expect(result.content).not.toContain("parameter=")
	})

	it("should strip partial (streaming) tool calls without closing tag", () => {
		const partial =
			tag("tool_call") +
			"\n" +
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"cjpm --version" +
			parameterTag("command", true)

		const result = sanitizeXmlToolCalls(partial)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.content).not.toContain("tool_call")
		expect(result.content).not.toContain("function=")
		expect(result.content).not.toContain("parameter=")
	})

	it("should strip individual function and parameter tags", () => {
		const content =
			functionTag("read_file") +
			"\n" +
			parameterTag("path") +
			"src/main.cj" +
			parameterTag("path", true) +
			"\n" +
			functionTag("read_file", true)

		const result = sanitizeXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.content).not.toContain("function=")
		expect(result.content).not.toContain("parameter=")
	})

	it("should strip multiple tool call blocks in one message", () => {
		const block1 = xmlToolCallBlock(functionTag("execute_command") + "\n" + functionTag("execute_command", true))
		const block2 = xmlToolCallBlock(functionTag("read_file") + "\n" + functionTag("read_file", true))
		const content = "Step 1:\n" + block1 + "\nStep 2:\n" + block2 + "\nDone."

		const result = sanitizeXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.content).toContain("Step 1:")
		expect(result.content).toContain("Step 2:")
		expect(result.content).toContain("Done.")
		expect(result.content).not.toContain("tool_call")
	})

	it("should clean up excess whitespace after stripping", () => {
		const block = xmlToolCallBlock(functionTag("list_files") + functionTag("list_files", true))
		const content = "Before\n\n\n" + block + "\n\n\nAfter"

		const result = sanitizeXmlToolCalls(content)
		// Should not have 3+ consecutive newlines
		expect(result.content).not.toMatch(/\n{3,}/)
	})

	it("should not affect normal markdown content", () => {
		const content = [
			"# Heading",
			"```javascript",
			"const x = 1;",
			"```",
			"Some **bold** and *italic* text.",
			"[a link](https://example.com)",
		].join("\n")

		const result = sanitizeXmlToolCalls(content)
		expect(result.content).toBe(content)
		expect(result.hadXmlToolCalls).toBe(false)
	})

	it("should not affect code blocks containing HTML-like tags", () => {
		// A code block with regular HTML tags should not be affected
		// because our regex only matches specific tool call patterns
		const content = '```html\n<div class="container">\n  <p>Hello</p>\n</div>\n```'

		const result = sanitizeXmlToolCalls(content)
		expect(result.content).toBe(content)
		expect(result.hadXmlToolCalls).toBe(false)
	})
})

// ── parseXmlToolCalls tests ──────────────────────────────────────────────

describe("parseXmlToolCalls", () => {
	it("should return empty result for empty content", () => {
		const result = parseXmlToolCalls("")
		expect(result.content).toBe("")
		expect(result.parsedToolCalls).toEqual([])
		expect(result.hadXmlToolCalls).toBe(false)
	})

	it("should return empty result when no XML tool calls are present", () => {
		const result = parseXmlToolCalls("Just a normal message with no tool calls.")
		expect(result.parsedToolCalls).toEqual([])
		expect(result.hadXmlToolCalls).toBe(false)
	})

	it("should parse a single execute_command tool call", () => {
		const body =
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"cjpm build" +
			parameterTag("command", true) +
			"\n" +
			parameterTag("cwd") +
			"d:/project" +
			parameterTag("cwd", true) +
			"\n" +
			functionTag("execute_command", true)
		const content = "Running build:\n" + xmlToolCallBlock(body)

		const result = parseXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.content).toContain("Running build:")
		expect(result.content).not.toContain("tool_call")
		expect(result.parsedToolCalls).toHaveLength(1)

		const tc = result.parsedToolCalls[0]
		expect(tc.type).toBe("tool_use")
		expect(tc.name).toBe("execute_command")
		expect(tc.partial).toBe(false)
		expect(tc.nativeArgs).toBeDefined()
		expect((tc.nativeArgs as any).command).toBe("cjpm build")
		expect((tc.nativeArgs as any).cwd).toBe("d:/project")
	})

	it("should parse a list_files tool call", () => {
		const body =
			functionTag("list_files") +
			"\n" +
			parameterTag("path") +
			"src" +
			parameterTag("path", true) +
			"\n" +
			parameterTag("recursive") +
			"true" +
			parameterTag("recursive", true) +
			"\n" +
			functionTag("list_files", true)
		const content = xmlToolCallBlock(body)

		const result = parseXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.parsedToolCalls).toHaveLength(1)

		const tc = result.parsedToolCalls[0]
		expect(tc.name).toBe("list_files")
		expect((tc.nativeArgs as any).path).toBe("src")
		expect((tc.nativeArgs as any).recursive).toBe(true)
	})

	it("should parse multiple tool calls in one message", () => {
		const body1 =
			functionTag("list_files") +
			"\n" +
			parameterTag("path") +
			"." +
			parameterTag("path", true) +
			"\n" +
			functionTag("list_files", true)
		const body2 =
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"cjpm test" +
			parameterTag("command", true) +
			"\n" +
			functionTag("execute_command", true)
		const content = "Step 1:\n" + xmlToolCallBlock(body1) + "\nStep 2:\n" + xmlToolCallBlock(body2)

		const result = parseXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.parsedToolCalls).toHaveLength(2)
		expect(result.parsedToolCalls[0].name).toBe("list_files")
		expect(result.parsedToolCalls[1].name).toBe("execute_command")
		expect(result.content).toContain("Step 1:")
		expect(result.content).toContain("Step 2:")
	})

	it("should skip tool calls with invalid tool names", () => {
		const body =
			functionTag("nonexistent_tool") +
			"\n" +
			parameterTag("foo") +
			"bar" +
			parameterTag("foo", true) +
			"\n" +
			functionTag("nonexistent_tool", true)
		const content = xmlToolCallBlock(body)

		const result = parseXmlToolCalls(content)
		expect(result.hadXmlToolCalls).toBe(true)
		expect(result.parsedToolCalls).toHaveLength(0)
	})

	it("should handle quoted parameter attribute values", () => {
		const body =
			functionTag("execute_command") +
			"\n" +
			parameterTagQuoted("command") +
			"cjpm --version" +
			parameterTagQuoted("command", true) +
			"\n" +
			functionTag("execute_command", true)
		const content = xmlToolCallBlock(body)

		const result = parseXmlToolCalls(content)
		expect(result.parsedToolCalls).toHaveLength(1)
		expect((result.parsedToolCalls[0].nativeArgs as any).command).toBe("cjpm --version")
	})

	it("should handle multiline parameter values", () => {
		const fileContent = 'fn main() {\n  println("hello")\n}'
		const body =
			functionTag("write_to_file") +
			"\n" +
			parameterTag("path") +
			"src/main.cj" +
			parameterTag("path", true) +
			"\n" +
			parameterTag("content") +
			fileContent +
			parameterTag("content", true) +
			"\n" +
			functionTag("write_to_file", true)
		const content = xmlToolCallBlock(body)

		const result = parseXmlToolCalls(content)
		expect(result.parsedToolCalls).toHaveLength(1)
		const tc = result.parsedToolCalls[0]
		expect(tc.name).toBe("write_to_file")
		expect((tc.nativeArgs as any).path).toBe("src/main.cj")
		expect((tc.nativeArgs as any).content).toContain("fn main()")
		expect((tc.nativeArgs as any).content).toContain("println")
	})

	it("should not parse partial (streaming) tool calls", () => {
		// No closing tool_call tag — this is a streaming partial
		const partial =
			tag("tool_call") +
			"\n" +
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"cjpm build" +
			parameterTag("command", true)

		const result = parseXmlToolCalls(partial)
		expect(result.hadXmlToolCalls).toBe(false)
		expect(result.parsedToolCalls).toEqual([])
	})

	it("should preserve text surrounding tool calls", () => {
		const body =
			functionTag("execute_command") +
			"\n" +
			parameterTag("command") +
			"echo hello" +
			parameterTag("command", true) +
			"\n" +
			functionTag("execute_command", true)
		const content = "Before text\n\n" + xmlToolCallBlock(body) + "\n\nAfter text"

		const result = parseXmlToolCalls(content)
		expect(result.content).toContain("Before text")
		expect(result.content).toContain("After text")
		expect(result.content).not.toContain("tool_call")
		expect(result.content).not.toContain("function=")
	})

	it("should generate unique IDs for each parsed tool call", () => {
		const body1 =
			functionTag("list_files") +
			"\n" +
			parameterTag("path") +
			"." +
			parameterTag("path", true) +
			"\n" +
			functionTag("list_files", true)
		const body2 =
			functionTag("list_files") +
			"\n" +
			parameterTag("path") +
			"src" +
			parameterTag("path", true) +
			"\n" +
			functionTag("list_files", true)
		const content = xmlToolCallBlock(body1) + "\n" + xmlToolCallBlock(body2)

		const result = parseXmlToolCalls(content)
		expect(result.parsedToolCalls).toHaveLength(2)
		// IDs should be unique even for same tool
		const id1 = result.parsedToolCalls[0].id
		const id2 = result.parsedToolCalls[1].id
		expect(id1).toBeDefined()
		expect(id2).toBeDefined()
		expect(id1).not.toBe(id2)
	})
})
