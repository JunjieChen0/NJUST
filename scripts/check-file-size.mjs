#!/usr/bin/env node

/**
 * File-size ratchet for production TypeScript.
 *
 * - Hard-fails any production file above 2000 lines.
 * - Files already above 1000 lines are recorded in file-size-baseline.json and
 *   may only shrink, never grow.
 * - New files above 1000 lines fail until split (or explicitly reviewed).
 *
 * Usage:
 *   node scripts/check-file-size.mjs
 *   node scripts/check-file-size.mjs --update-baseline  # only permits decreases
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const baselinePath = join(rootDir, "scripts/file-size-baseline.json")
const updateBaseline = process.argv.includes("--update-baseline")
const WARN_LINES = 1000
const HARD_LIMIT = 2000
const SCAN_DIRS = ["src", "packages", "apps", "webview-ui"]
const EXTENSIONS = new Set([".ts", ".tsx"])
const EXCLUDED = /(?:__tests__|__mocks__|\.spec\.|\.test\.|\/dist\/|\/build\/|\/out\/)/

function productionFiles() {
	return SCAN_DIRS.flatMap((dir) => {
		const output = execSync(`git ls-files --cached --others --exclude-standard -- "${dir}"`, {
			cwd: rootDir,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		})
		return output
			.split("\n")
			.map((file) => file.trim().replaceAll("\\", "/"))
			.filter((file) => [...EXTENSIONS].some((ext) => file.endsWith(ext)) && !EXCLUDED.test(file))
	})
}

function measure() {
	const files = productionFiles()
	const result = new Map()
	for (const file of files) {
		try {
			result.set(file, readFileSync(join(rootDir, file), "utf8").split(/\r?\n/).length)
		} catch {
			// A path can disappear between git enumeration and reading; ignore it.
		}
	}
	return result
}

function readBaseline() {
	if (!existsSync(baselinePath)) return {}
	return JSON.parse(readFileSync(baselinePath, "utf8"))
}

const current = measure()
const oversized = Object.fromEntries([...current].filter(([, lines]) => lines > WARN_LINES).sort((a, b) => b[1] - a[1]))
const baselineExists = existsSync(baselinePath)
const baseline = readBaseline()
const initializingBaseline = updateBaseline && !baselineExists
const failures = []

for (const [file, lines] of Object.entries(oversized)) {
	if (lines > HARD_LIMIT) failures.push(`${file}: ${lines} lines exceeds the ${HARD_LIMIT}-line hard limit`)
	// The first baseline records the status quo. Later updates may only shrink.
	if (!initializingBaseline) {
		if (!(file in baseline))
			failures.push(`${file}: ${lines} lines is a NEW file above ${WARN_LINES} lines; split it first`)
		else if (lines > baseline[file])
			failures.push(`${file}: grew from ${baseline[file]} to ${lines} lines; oversized files may only shrink`)
	}
}

if (updateBaseline) {
	if (failures.length > 0) {
		console.error("Cannot update the file-size baseline while files are growing:\n" + failures.join("\n"))
		process.exit(1)
	}
	writeFileSync(baselinePath, JSON.stringify(oversized, null, 2) + "\n", "utf8")
	console.log(`Updated file-size baseline (${Object.keys(oversized).length} oversized files, no increases).`)
} else if (failures.length > 0) {
	console.error("File-size gate failed:\n" + failures.join("\n"))
	process.exit(1)
} else {
	console.log(
		`File-size gate passed: ${current.size} production files, ${Object.keys(oversized).length} grandfathered files above ${WARN_LINES} lines, none grew.`,
	)
}
