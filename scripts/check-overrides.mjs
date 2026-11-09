#!/usr/bin/env node

/**
 * Guard pnpm.overrides growth.
 *
 * Overrides apply to the whole dependency tree and mask upstream advisories, so
 * they must not accumulate silently. The count is ratcheted against a baseline:
 * adding an override fails until the baseline and the policy document are
 * updated in the same change (which forces a review of the rationale).
 *
 * Usage:
 *   node scripts/check-overrides.mjs
 *   node scripts/check-overrides.mjs --update-baseline
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const baselinePath = join(rootDir, "scripts/overrides-baseline.json")
const policyPath = join(rootDir, "security/overrides-policy.md")
const updateBaseline = process.argv.includes("--update-baseline")

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))
const overrides = pkg.pnpm?.overrides ?? {}
const entries = Object.entries(overrides)
const ranged = entries.filter(([, value]) => /^[<>]=?/.test(String(value)))

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null
const count = entries.length
const failures = []

if (!existsSync(policyPath)) {
	failures.push(`missing ${policyPath}; every override must be documented in the policy file`)
}

if (baseline) {
	if (count > baseline.count) {
		failures.push(
			`overrides grew from ${baseline.count} to ${count}; document the new entry in security/overrides-policy.md, then rerun with --update-baseline`,
		)
	}
	if (ranged.length > baseline.ranged) {
		failures.push(
			`floating (>=) overrides grew from ${baseline.ranged} to ${ranged.length}; prefer exact minimums or ^ ranges`,
		)
	}
}

if (updateBaseline) {
	if (failures.length > 0) {
		console.error("Cannot update overrides baseline:\n" + failures.join("\n"))
		process.exit(1)
	}
	writeFileSync(baselinePath, JSON.stringify({ count, ranged: ranged.length }, null, 2) + "\n", "utf8")
	console.log(`Updated overrides baseline: ${count} overrides (${ranged.length} floating).`)
} else if (failures.length > 0) {
	console.error("Overrides policy gate failed:\n" + failures.join("\n"))
	process.exit(1)
} else {
	console.log(`Overrides policy gate passed: ${count} overrides (${ranged.length} floating), baseline respected.`)
}
