/**
 * HTML sanitizer for rendering potentially untrusted content in the webview.
 *
 * Uses a defense-in-depth approach with multiple layers of sanitization.
 * While DOMPurify is the industry-standard recommendation for production use,
 * this implementation provides strong protection against common XSS vectors
 * without adding a dependency. If the project adds DOMPurify in the future,
 * replace the implementation below with `DOMPurify.sanitize(html)`.
 */

/** Tags whose entire element (including children) is stripped. */
const DANGEROUS_TAGS = [
	"script",
	"iframe",
	"frame",
	"object",
	"embed",
	"applet",
	"meta",
	"link",
	"base",
	"form",
	"input",
	"button",
	"select",
	"textarea",
	"isindex",
	"noscript",
]

function buildDangerousTagRegex(): RegExp {
	const alternation = DANGEROUS_TAGS.join("|")
	return new RegExp(`<\\s*(?:${alternation})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*(?:${alternation})\\s*>`, "gi")
}

function buildSelfClosingTagRegex(): RegExp {
	const alternation = DANGEROUS_TAGS.join("|")
	return new RegExp(`<\\s*(?:${alternation})\\b[^>]*/?\\s*>`, "gi")
}

/**
 * Matches event handler attributes in various syntactic forms:
 *   onerror=alert(1)        — unquoted
 *   onerror="alert(1)"      — double-quoted
 *   onerror='alert(1)'      — single-quoted
 *   onerror=`alert(1)`      — backtick-quoted
 *   onerror = alert(1)      — with spaces
 */
const EVENT_HANDLER = /\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|\S+)/gi

/** Dangerous URL schemes used in href, src, action, formaction, etc. */
const DANGEROUS_URL_SCHEMES =
	/(?:javascript|data|vbscript|jscript|behavior|mocha|livescript)\s*:/gi

/** Remove CSS expressions and behavior bindings (legacy IE). */
const CSS_EXPR = /expression\s*\(/gi
const CSS_BEHAVIOR = /behavior\s*:/gi

/** SVG-based XSS: onload, onbegin, onend, onrepeat, etc. on SVG elements. */
const SVG_EVENT = /\bon(?:load|begin|end|repeat|focusin|focusout|activate|scroll|zoom)\s*=/gi

/** Additional dangerous constructs in attribute values. */
const FORMACTION = /\bformaction\s*=/gi

export function sanitizeHtml(html: string): string {
	let result = html

	// Layer 1: Remove entire dangerous elements (both self-closing and paired)
	result = result.replace(buildDangerousTagRegex(), "")
	result = result.replace(buildSelfClosingTagRegex(), "")

	// Layer 2: Remove remaining <script> fragments (case-insensitive)
	result = result.replace(
		/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
		"",
	)

	// Layer 3: Strip all inline event handlers (covers quoted, unquoted, backtick)
	result = result.replace(EVENT_HANDLER, "")

	// Layer 4: Strip SVG-specific event handlers
	result = result.replace(SVG_EVENT, "")

	// Layer 5: Strip formaction attributes
	result = result.replace(FORMACTION, "")

	// Layer 6: Neutralize dangerous URL schemes
	result = result.replace(DANGEROUS_URL_SCHEMES, "blocked:")

	// Layer 7: Neutralize CSS expressions (legacy IE)
	result = result.replace(CSS_EXPR, "blocked(")
	result = result.replace(CSS_BEHAVIOR, "blocked:")

	return result
}

/**
 * Lightweight SVG sanitizer for Mermaid output.
 * Strips script elements and event handlers from SVG markup.
 */
export function sanitizeSvg(svg: string): string {
	return sanitizeHtml(svg)
}
