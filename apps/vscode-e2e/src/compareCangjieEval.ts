import * as fs from "node:fs/promises"
import { compareCangjieReports } from "../../../packages/evals/src/cangjie/report.js"

async function main(): Promise<void> {
	const [baseline, candidate] = process.argv.slice(2)
	if (!baseline || !candidate)
		throw new Error("Usage: compareCangjieEval <baseline-report.json> <candidate-report.json>")
	const before = JSON.parse(await fs.readFile(baseline, "utf8"))
	const after = JSON.parse(await fs.readFile(candidate, "utf8"))
	console.info(JSON.stringify(compareCangjieReports(before, after), null, 2))
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Comparison failed")
	process.exitCode = 1
})
