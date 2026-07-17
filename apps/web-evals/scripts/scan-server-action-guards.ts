import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..", "..", "..")
const SRC_DIR = join(ROOT, "apps", "web-evals", "src")

const GUARD_PATTERN = /requireAdminForAction\s*\(/
const USE_SERVER_PATTERN = /^["']use server["']/
const EXPORT_ASYNC_FN_PATTERN = /export\s+(?:async\s+)?function\s+(\w+)/g
const EXPORT_CONST_ASYNC_PATTERN = /export\s+const\s+(\w+)\s*=\s*async/g

interface Violation {
	file: string
	functionName: string
}

function findFiles(dir: string, ext: string): string[] {
	const results: string[] = []
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry)
		const stat = statSync(fullPath)
		if (stat.isDirectory() && entry !== "node_modules" && entry !== "__tests__") {
			results.push(...findFiles(fullPath, ext))
		} else if (entry.endsWith(ext)) {
			results.push(fullPath)
		}
	}
	return results
}

/**
 * Find the matching closing brace for an opening brace at position `start`.
 * Correctly handles nested braces, strings, template literals, and comments.
 */
function findMatchingBrace(content: string, start: number): number {
	let depth = 0
	let i = start
	while (i < content.length) {
		const ch = content[i]
		if (ch === "{") {
			depth++
		} else if (ch === "}") {
			depth--
			if (depth === 0) return i
		} else if (ch === "'" || ch === '"' || ch === "`") {
			// Skip string/template literal
			const quote = ch
			i++
			while (i < content.length && content[i] !== quote) {
				if (content[i] === "\\") i++ // skip escaped char
				i++
			}
		} else if (ch === "/" && content[i + 1] === "/") {
			// Skip line comment
			while (i < content.length && content[i] !== "\n") i++
		} else if (ch === "/" && content[i + 1] === "*") {
			// Skip block comment
			i += 2
			while (i < content.length - 1 && !(content[i] === "*" && content[i + 1] === "/")) i++
			i++ // skip closing /
		}
		i++
	}
	return content.length // fallback: end of file
}

function checkFile(filePath: string): Violation[] {
	const content = readFileSync(filePath, "utf-8")

	if (!USE_SERVER_PATTERN.test(content.split("\n")[0] ?? "")) {
		return []
	}

	const violations: Violation[] = []

	const fnNames: string[] = []
	let match: RegExpExecArray | null

	const asyncFnRegex = new RegExp(EXPORT_ASYNC_FN_PATTERN)
	while ((match = asyncFnRegex.exec(content)) !== null) {
		fnNames.push(match[1]!)
	}

	const constAsyncRegex = new RegExp(EXPORT_CONST_ASYNC_PATTERN)
	while ((match = constAsyncRegex.exec(content)) !== null) {
		fnNames.push(match[1]!)
	}

	for (const fnName of fnNames) {
		const fnStartRegex = new RegExp(
			`export\\s+(?:async\\s+)?function\\s+${fnName}\\b|export\\s+const\\s+${fnName}\\s*=`,
		)
		const fnStartMatch = fnStartRegex.exec(content)
		if (!fnStartMatch) continue

		// For regular functions: skip past the parameter list to find the body's opening brace.
		// For arrow functions: skip to the opening brace of the function body.
		const fnBodySearchStart = fnStartMatch.index + fnStartMatch[0].length

		// Find the first `(` after the function name — this is the parameter list.
		// We need to skip past it to find the actual function body `{`.
		let bodyStart = fnBodySearchStart
		const parenPos = content.indexOf("(", fnBodySearchStart)
		if (parenPos !== -1 && parenPos < fnBodySearchStart + 200) {
			// Find matching `)` for the parameter list
			let parenDepth = 0
			let j = parenPos
			while (j < content.length) {
				if (content[j] === "(") parenDepth++
				else if (content[j] === ")") {
					parenDepth--
					if (parenDepth === 0) {
						bodyStart = j + 1
						break
					}
				}
				j++
			}
		}

		// Now find the opening `{` of the function body.
		// Must skip return type annotations like `: Promise<{ success: boolean }>`
		// by tracking angle bracket depth.
		let openBrace = -1
		let angleBracketDepth = 0
		for (let k = bodyStart; k < content.length; k++) {
			const c = content[k]
			if (c === "<") angleBracketDepth++
			else if (c === ">" && angleBracketDepth > 0) angleBracketDepth--
			else if (c === "{" && angleBracketDepth === 0) {
				openBrace = k
				break
			}
		}
		if (openBrace === -1) {
			violations.push({
				file: relative(ROOT, filePath).replace(/\\/g, "/"),
				functionName: fnName,
			})
			continue
		}

		// Find matching closing brace — scan the ENTIRE function body
		const closeBrace = findMatchingBrace(content, openBrace)
		const fnBody = content.slice(openBrace, closeBrace + 1)

		if (!GUARD_PATTERN.test(fnBody)) {
			violations.push({
				file: relative(ROOT, filePath).replace(/\\/g, "/"),
				functionName: fnName,
			})
		}
	}

	return violations
}

function main(): void {
	if (!existsSync(SRC_DIR)) {
		console.error(`Source directory not found: ${SRC_DIR}`)
		process.exit(1)
	}

	const tsFiles = findFiles(SRC_DIR, ".ts")
	const tsxFiles = findFiles(SRC_DIR, ".tsx")
	const allFiles = [...tsFiles, ...tsxFiles]

	const allViolations: Violation[] = []
	for (const file of allFiles) {
		allViolations.push(...checkFile(file))
	}

	if (allViolations.length > 0) {
		console.error("\n✗ Server Action guard scan failed!")
		console.error("  The following exported functions lack requireAdminForAction():\n")
		for (const v of allViolations) {
			console.error(`  ${v.file} → ${v.functionName}()`)
		}
		console.error(`\n  Total: ${allViolations.length} violation(s)`)
		console.error("\n  Every exported function in a \"use server\" file must call")
		console.error("  requireAdminForAction() as its first statement.\n")
		process.exit(1)
	}

	console.log("✓ Server Action guard scan passed - all exports are protected.")
}

main()
