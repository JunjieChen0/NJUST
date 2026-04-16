import { INLINE_CURSOR_MARKER } from "./contextExtraction"

/**
 * Strip a markdown fenced block wrapper if the model returned one.
 */
export function stripMarkdownCodeFence(text: string): string {
	const t = text.trim()
	const fence = /^```(?:\w+)?\s*\n?([\s\S]*?)```$/m.exec(t)
	if (fence) {
		return fence[1].trimEnd()
	}
	return text
}

/**
 * Keep at most `maxLines` lines (newline-separated).
 */
export function limitMaxLines(text: string, maxLines: number): string {
	const lines = text.split("\n")
	if (lines.length <= maxLines) {
		return text
	}
	return lines.slice(0, maxLines).join("\n")
}

/**
 * If the first line repeats the document text already after the cursor, strip that echo.
 */
export function trimDuplicateLineSuffix(insertText: string, lineSuffixAfterCursor: string): string {
	if (!insertText || !lineSuffixAfterCursor) {
		return insertText
	}
	const firstNl = insertText.indexOf("\n")
	const firstLine = firstNl === -1 ? insertText : insertText.slice(0, firstNl)
	const rest = firstNl === -1 ? "" : insertText.slice(firstNl)
	if (firstLine.startsWith(lineSuffixAfterCursor)) {
		return firstLine.slice(lineSuffixAfterCursor.length) + rest
	}
	return insertText
}

/**
 * If the model echoed the entire current line as the first line of the completion, drop that line.
 */
export function stripFirstLineIfDuplicatesCurrentLine(insertText: string, fullLineText: string): string {
	const normalized = fullLineText.trimEnd()
	if (!normalized) {
		return insertText
	}
	const firstNl = insertText.indexOf("\n")
	const firstLine = firstNl === -1 ? insertText : insertText.slice(0, firstNl)
	if (firstLine.trimEnd() === normalized) {
		return firstNl === -1 ? "" : insertText.slice(firstNl + 1)
	}
	return insertText
}

/**
 * If the model repeated the text already before the cursor at the start of the insert, strip it once.
 */
export function stripDuplicatePrefixFromInsert(insertText: string, prefixBeforeCursor: string): string {
	if (!prefixBeforeCursor || !insertText) {
		return insertText
	}
	if (insertText.startsWith(prefixBeforeCursor)) {
		return insertText.slice(prefixBeforeCursor.length)
	}
	if (insertText.startsWith("\n") && insertText.slice(1).startsWith(prefixBeforeCursor)) {
		return insertText.slice(1 + prefixBeforeCursor.length)
	}
	if (insertText.startsWith("\r\n") && insertText.slice(2).startsWith(prefixBeforeCursor)) {
		return insertText.slice(2 + prefixBeforeCursor.length)
	}
	return insertText
}

export function normalizeInlineInsert(
	insertText: string,
	opts: {
		prefixBeforeCursor: string
		lineSuffixAfterCursor: string
		fullLineText: string
		maxLines: number
	},
): string {
	let raw = stripMarkdownCodeFence(insertText.trim())
	if (!raw) {
		return ""
	}
	raw = stripFirstLineIfDuplicatesCurrentLine(raw, opts.fullLineText)
	raw = stripDuplicatePrefixFromInsert(raw, opts.prefixBeforeCursor)
	raw = trimDuplicateLineSuffix(raw, opts.lineSuffixAfterCursor)
	raw = limitMaxLines(raw, opts.maxLines)
	if (INLINE_CURSOR_MARKER.length > 0) {
		raw = raw.split(INLINE_CURSOR_MARKER).join("")
	}
	return raw
}

/** Basic bracket balance for `( )`, `[ ]`, `{ }` in the inserted snippet. */
export function passesBasicBracketBalance(text: string): boolean {
	let p = 0,
		s = 0,
		c = 0
	for (const ch of text) {
		if (ch === "(") p++
		else if (ch === ")") p--
		else if (ch === "[") s++
		else if (ch === "]") s--
		else if (ch === "{") c++
		else if (ch === "}") c--
		if (p < 0 || s < 0 || c < 0) return false
	}
	return p === 0 && s === 0 && c === 0
}
