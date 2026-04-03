/** Long assistant bodies collapse below this length (characters). */
export const CLOUD_AGENT_COLLAPSE_MIN_CHARS = 420

/**
 * Extract balanced JSON object substring starting at first `{`, or null.
 */
function extractJsonObject(s: string): string | null {
	const i = s.indexOf("{")
	if (i < 0) return null
	let depth = 0
	for (let j = i; j < s.length; j++) {
		const c = s[j]
		if (c === "{") depth++
		else if (c === "}") {
			depth--
			if (depth === 0) return s.slice(i, j + 1)
		}
	}
	return null
}

/**
 * Build a short plain-text preview for collapsed cloud-agent assistant messages.
 * Handles prefix + JSON with `text` field (common cloud codegen responses).
 */
export function buildCloudAgentPreviewSummary(raw: string): string {
	const t = raw.trim()
	if (!t) return ""

	const jsonStr = extractJsonObject(t)
	if (jsonStr) {
		try {
			const parsed = JSON.parse(jsonStr) as { text?: unknown }
			if (parsed && typeof parsed.text === "string") {
				const prefix = t.slice(0, t.indexOf("{")).trim()
				const inner = parsed.text
					.replace(/\\n/g, "\n")
					.replace(/\\r/g, "")
					.replace(/\\"/g, '"')
					.trim()
				const firstLine = inner.split(/\n/)[0] ?? inner
				const snippet = firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine
				if (prefix) return `${prefix}\n${snippet}`
				return snippet
			}
		} catch {
			/* fall through — e.g. `{` inside string breaks brace extraction */
		}
	}

	/** Fallback: first JSON string value for `"text"` (handles some malformed / nested braces). */
	const textStrMatch = t.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/)
	if (textStrMatch?.[1]) {
		const prefix = t.slice(0, t.indexOf("{")).trim()
		const inner = textStrMatch[1]
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "")
			.replace(/\\"/g, '"')
			.trim()
		const firstLine = inner.split(/\n/)[0] ?? inner
		const snippet = firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine
		if (prefix) return `${prefix}\n${snippet}`
		return snippet
	}

	const firstLine = t.split("\n")[0] ?? t
	if (t.length <= 360) return t
	if (firstLine.length > 300) return `${firstLine.slice(0, 300)}…`
	return `${firstLine} …`
}

export function shouldCollapseCloudAgentText(text: string | undefined, partial?: boolean): boolean {
	if (!text || partial) return false
	return text.trim().length >= CLOUD_AGENT_COLLAPSE_MIN_CHARS
}

function tryParseJsonTail(raw: string): { isError?: boolean; text?: string } | null {
	const jsonStr = extractJsonObject(raw)
	if (!jsonStr) return null
	try {
		return JSON.parse(jsonStr) as { isError?: boolean; text?: string }
	} catch {
		return null
	}
}

/** Raw inner payload from `text` field (unescaped), if JSON present. */
export function getCloudAgentInnerText(raw: string): string | null {
	const t = raw.trim()
	const parsed = tryParseJsonTail(t)
	if (parsed && typeof parsed.text === "string") {
		return parsed.text
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "")
			.replace(/\\"/g, '"')
			.trim()
	}
	const textStrMatch = t.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/)
	if (textStrMatch?.[1]) {
		return textStrMatch[1]
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "")
			.replace(/\\"/g, '"')
			.trim()
	}
	return null
}

function looksLikeRawTransportOrJson(line: string): boolean {
	const s = line.trim()
	if (!s) return true
	if (/^\d+\.\s*\[(OK|ERR|ERROR|FAIL)\]/i.test(s)) return true
	if (/^step:[^\s]+/i.test(s)) return true
	if (/^\s*\{/.test(s) && /"isError"|"text"\s*:/.test(s)) return true
	if (s.length > 180 && /[{]["']?isError|["']text["']\s*:/.test(s)) return true
	return false
}

/** Returns true when the raw message starts with a step indicator that should force full collapse. */
function hasStepPrefix(raw: string): boolean {
	const t = raw.trim()
	return /^\[OK\]|^\[ERR\]|^\[ERROR\]|^\[FAIL\]|^step:/i.test(t)
}

/**
 * Human-facing lines only for the collapsed card (never raw JSON / step logs).
 */
export function getCloudAgentCardSummary(raw: string): { title: string; hint: string | null } {
	const outer = raw.trim()
	if (!outer) return { title: "", hint: null }

	// Force full collapse for step-log messages — don't show any preview text
	if (hasStepPrefix(outer)) return { title: "", hint: null }

	const inner = getCloudAgentInnerText(outer)

	if (inner) {
		const nameM = inner.match(/^\s*---\s*[\r\n]+\s*name:\s*([^\r\n]+)/m) ?? inner.match(/\bname:\s*([^\r\n]+)/)
		let title = nameM?.[1]?.trim() ?? ""
		let hint: string | null = null

		const descQuoted = inner.match(/\bdescription:\s*"((?:[^"\\]|\\.)*)"/)
		if (descQuoted?.[1]) {
			hint = descQuoted[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim()
		} else {
			const descPlain = inner.match(/\bdescription:\s*([^\r\n]+)/)
			if (descPlain?.[1]) hint = descPlain[1].trim()
		}
		if (hint && hint.length > 160) hint = `${hint.slice(0, 160)}…`

		if (!title) {
			for (const line of inner.split(/\r?\n/)) {
				const L = line.trim()
				if (!L || L === "---") continue
				if (/^name:\s*/i.test(L)) continue
				if (/^description:\s*/i.test(L)) continue
				if (looksLikeRawTransportOrJson(L)) continue
				title = L.length > 140 ? `${L.slice(0, 140)}…` : L
				break
			}
		}

		if (title && !looksLikeRawTransportOrJson(title)) {
			return { title, hint }
		}
		return { title: "", hint: null }
	}

	/* Plain assistant text (no JSON envelope) */
	if (!outer.includes("{") || outer.length < 80) {
		const line = outer.split(/\r?\n/).find((l) => l.trim().length > 0) ?? outer
		const L = line.trim()
		if (L && !looksLikeRawTransportOrJson(L) && L.length <= 300) {
			return { title: L.length > 200 ? `${L.slice(0, 200)}…` : L, hint: null }
		}
	}

	return { title: "", hint: null }
}
