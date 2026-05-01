/**
 * HTML / SVG sanitizer for rendering potentially untrusted content in the webview.
 *
 * Delegates to DOMPurify (battle-tested, actively maintained) for defense-in-depth
 * XSS protection. The webview already runs in a sandboxed iframe with CSP, but
 * sanitizing server-provided / LLM-generated markup is an additional layer.
 */
import DOMPurify from "dompurify"
import type { Config } from "dompurify"

const HTML_CONFIG: Config = {
	ALLOWED_TAGS: [
		"b", "i", "em", "strong", "u", "s", "del", "ins",
		"a", "p", "br", "hr",
		"h1", "h2", "h3", "h4", "h5", "h6",
		"ul", "ol", "li", "dl", "dt", "dd",
		"code", "pre", "kbd", "samp", "var",
		"blockquote", "q", "cite",
		"table", "thead", "tbody", "tr", "th", "td",
		"span", "div",
		"img", "sub", "sup", "small", "mark",
	],
	ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "id", "target", "rel"],
	ALLOW_DATA_ATTR: false,
	ADD_ATTR: ["target"],
}

const SVG_CONFIG: Config = {
	...HTML_CONFIG,
	// Allow SVG structural elements so Mermaid diagrams render.
	ADD_TAGS: ["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan", "defs", "use", "image", "marker", "linearGradient", "radialGradient", "stop", "pattern", "symbol", "title", "desc", "style"],
	ADD_ATTR: ["d", "viewBox", "fill", "stroke", "stroke-width", "transform", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points", "text-anchor", "dominant-baseline", "font-family", "font-size", "font-weight", "text-decoration", "marker-end", "marker-start", "clip-path", "clip-rule", "fill-rule", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "visibility", "display", "overflow", "xmlns", "preserveAspectRatio", "width", "height"],
}

export function sanitizeHtml(html: string): string {
	return DOMPurify.sanitize(html, HTML_CONFIG) as string
}

export function sanitizeSvg(svg: string): string {
	return DOMPurify.sanitize(svg, SVG_CONFIG) as string
}
