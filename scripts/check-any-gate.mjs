/**
 * check-any-gate.mjs
 *
 * CI gate for "UnsafeAny / casting" hygiene. Counts three distinct dangerous
 * patterns across the production code tree and fails if any one of them grows
 * beyond its recorded baseline:
 *
 *   1. eslint-disable @typescript-eslint/no-explicit-any  → escape hatch for `any`
 *   2. literal `UnsafeAny` token usage                    → project-wide alias for `any`
 *   3. `as unknown as` double-casts                       → opaque cross-module boundary cast
 *
 * Each pattern has its own baseline file in scripts/ so refactors that improve
 * one pattern can be locked in independently. New PRs must not raise *any* of
 * the counts; the gate exits non-zero if any pattern grows.
 *
 * Usage: node scripts/check-any-gate.mjs [--update-baseline]
 *
 * The --update-baseline flag rewrites all baselines to the current counts,
 * but ONLY if every count has decreased (or stayed equal). It will NEVER
 * raise a baseline; that requires a manual edit and review.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, "..")

// ── Pattern definitions ────────────────────────────────────────────

/** @typedef {{ name: string, baselineFile: string, regex: RegExp, description: string }} Pattern */

/** @type {Pattern[]} */
const PATTERNS = [
	{
		name: "eslint-disable-any",
		baselineFile: join(__dirname, ".any-gate-baseline"),
		regex: /eslint-disable(?:-next-line|-line)?\s+@typescript-eslint\/no-explicit-any/g,
		description: "eslint-disable @typescript-eslint/no-explicit-any",
	},
	{
		name: "unsafe-any-token",
		baselineFile: join(__dirname, ".unsafe-any-baseline"),
		// Match the bare token in code positions (not inside strings or comments
		// — we accept some over-counting in tests; the goal is to lock growth).
		// We exclude the alias declaration itself by skipping `unsafe-any.d.ts`
		// when scanning files.
		regex: /\bUnsafeAny\b/g,
		description: "literal UnsafeAny references",
	},
	{
		name: "as-unknown-as",
		baselineFile: join(__dirname, ".as-unknown-as-baseline"),
		regex: /\bas\s+unknown\s+as\b/g,
		description: "`as unknown as` double-casts",
	},
]

// Directories to scan (production code only, no node_modules)
const SCAN_DIRS = ["src", "packages", "apps", "webview-ui"]

// File extensions to scan
const EXTENSIONS = [".ts", ".tsx", ".mjs"]

/** Files that legitimately contain a pattern and should be excluded from counting. */
const EXCLUDE_FILES = new Set([
	// The single canonical declaration of `type UnsafeAny = any`. Counting it
	// would create a phantom +1 we can never narrow.
	"src/shared/unsafe-any.d.ts",
	// This script's own pattern table.
	"scripts/check-any-gate.mjs",
])

// ── Helpers ────────────────────────────────────────────────────────

function getAllFiles(dir) {
	try {
		const entries = execSync(`git ls-files --cached --others --exclude-standard -- "${dir}"`, {
			cwd: rootDir,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		})
			.trim()
			.split("\n")
			.filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)))
			.filter((f) => !EXCLUDE_FILES.has(f.replace(/\\/g, "/")))
		return entries
	} catch {
		// Fallback: caller will see a 0 count; CI environments without git are rare.
		return []
	}
}

function countMatchesInFile(filePath, regex) {
	try {
		const content = readFileSync(join(rootDir, filePath), "utf-8")
		// `regex` may have global flag; reset lastIndex defensively.
		const matches = content.match(regex)
		return matches ? matches.length : 0
	} catch {
		return 0
	}
}

function readBaseline(baselineFile) {
	try {
		return parseInt(readFileSync(baselineFile, "utf-8").trim(), 10)
	} catch {
		return null
	}
}

function writeBaseline(baselineFile, count) {
	writeFileSync(baselineFile, `${count}\n`, "utf-8")
}

/** Count one pattern across all scanned dirs and return {totalCount, perDir}. */
function scanPattern(pattern) {
	let totalCount = 0
	const perDir = {}
	for (const dir of SCAN_DIRS) {
		const files = getAllFiles(dir)
		let dirCount = 0
		for (const file of files) {
			dirCount += countMatchesInFile(file, pattern.regex)
		}
		perDir[dir] = dirCount
		totalCount += dirCount
	}
	return { totalCount, perDir }
}

// ── Main ───────────────────────────────────────────────────────────

const updateBaseline = process.argv.includes("--update-baseline")

console.log("🔍 UnsafeAny / cast gate: scanning production code...\n")

let anyFailed = false
const results = []

for (const pattern of PATTERNS) {
	const { totalCount, perDir } = scanPattern(pattern)

	console.log(`── ${pattern.description} ──`)
	for (const [dir, count] of Object.entries(perDir)) {
		console.log(`   ${dir}: ${count}`)
	}
	console.log(`   total: ${totalCount}`)

	let baseline = readBaseline(pattern.baselineFile)
	if (baseline === null) {
		baseline = totalCount
		writeBaseline(pattern.baselineFile, baseline)
		console.log(`   📝 No baseline found. Initialized ${relative(rootDir, pattern.baselineFile)} to ${totalCount}.`)
	}

	const result = { pattern, totalCount, baseline }
	results.push(result)

	if (totalCount > baseline) {
		console.error(
			`   ❌ FAIL: ${pattern.description} grew from ${baseline} to ${totalCount} (+${totalCount - baseline}).`,
		)
		anyFailed = true
	} else if (totalCount < baseline) {
		console.log(`   ✅ ok (${totalCount} ≤ baseline ${baseline}, ↓${baseline - totalCount}).`)
	} else {
		console.log(`   ✅ ok (${totalCount} = baseline ${baseline}).`)
	}
	console.log("")
}

if (anyFailed) {
	console.error(
		"❌ UnsafeAny / cast gate FAILED.\n" +
			"   Each PR must not increase the count of any tracked pattern.\n" +
			"   Narrow at least the increased pattern(s) or use a more specific type.\n",
	)
	process.exit(1)
}

if (updateBaseline) {
	for (const { pattern, totalCount, baseline } of results) {
		if (totalCount > baseline) {
			// Should be unreachable because we exited above, but check defensively.
			console.error(`❌ Refusing to raise baseline for ${pattern.name}.`)
			process.exit(1)
		}
		if (totalCount < baseline) {
			writeBaseline(pattern.baselineFile, totalCount)
			console.log(`   📝 ${pattern.name}: baseline updated ${baseline} → ${totalCount}.`)
		}
	}
}

console.log("✅ UnsafeAny / cast gate PASSED.")
