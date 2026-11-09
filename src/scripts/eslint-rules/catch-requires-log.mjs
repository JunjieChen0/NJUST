/**
 * Require a logger call inside every catch block in security-sensitive files.
 *
 * Kept as a tiny local rule so it can be enabled incrementally instead of
 * failing the whole repository on legacy catches at once.
 */
const LOGGER_METHODS = new Set(["debug", "info", "warn", "error"])

function containsLoggerCall(node) {
	if (!node || typeof node !== "object") return false
	if (node.type === "CallExpression") {
		const callee = node.callee
		if (
			callee?.type === "MemberExpression" &&
			!callee.computed &&
			callee.object?.type === "Identifier" &&
			callee.object.name === "logger" &&
			callee.property?.type === "Identifier" &&
			LOGGER_METHODS.has(callee.property.name)
		) {
			return true
		}
	}

	for (const [key, value] of Object.entries(node)) {
		if (key === "parent") continue
		if (Array.isArray(value)) {
			for (const child of value) {
				if (child && typeof child.type === "string" && containsLoggerCall(child)) return true
			}
		} else if (value && typeof value.type === "string" && containsLoggerCall(value)) {
			return true
		}
	}
	return false
}

export default {
	meta: {
		type: "problem",
		docs: { description: "Require logger.debug/info/warn/error in every catch block" },
		schema: [],
	},
	create(context) {
		return {
			CatchClause(node) {
				if (!containsLoggerCall(node.body)) {
					context.report({
						node,
						message:
							"Catch blocks in this file must call logger.debug/info/warn/error with the caught error.",
					})
				}
			},
		}
	},
}
