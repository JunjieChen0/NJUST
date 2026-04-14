#!/usr/bin/env node

import { createInterface } from "readline"
import { createReadStream } from "fs"
import { writeFile } from "fs/promises"
import { glob } from "glob"

const args = process.argv.slice(2)
const csvMode = args.includes("--csv")
const outIndex = args.findIndex((arg) => arg === "--out")
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined
const positional = args.filter((arg, idx) => !arg.startsWith("--") && idx !== outIndex + 1)
const rootDir = positional[0] ?? process.cwd()
const pattern = "**/task-metrics.jsonl"

const files = await glob(pattern, {
	cwd: rootDir,
	absolute: true,
	ignore: ["**/node_modules/**", "**/.git/**"],
})

if (files.length === 0) {
	console.log("No task-metrics.jsonl files found.")
	process.exit(0)
}

const summary = {
	files: files.length,
	rows: 0,
	cacheRequests: 0,
	cacheReadTokens: 0,
	cacheCreationTokens: 0,
	estimatedSavingsPercentAvg: 0,
	cacheHitRateAvg: 0,
	cacheBreaks: 0,
	cacheBreaksBySource: {},
	latestRows: [],
}

let cacheHitRateSum = 0
let savingsSum = 0

function mergeBreaks(target, incoming) {
	if (!incoming || typeof incoming !== "object") return
	for (const [key, value] of Object.entries(incoming)) {
		if (typeof value !== "number") continue
		target[key] = (target[key] ?? 0) + value
	}
}

for (const file of files) {
	const rl = createInterface({
		input: createReadStream(file, { encoding: "utf8" }),
		crlfDelay: Infinity,
	})

	for await (const line of rl) {
		if (!line.trim()) continue
		let row
		try {
			row = JSON.parse(line)
		} catch {
			continue
		}
		summary.rows += 1
		summary.cacheRequests += Number(row.cacheRequests ?? 0)
		summary.cacheReadTokens += Number(row.cacheReadTokens ?? 0)
		summary.cacheCreationTokens += Number(row.cacheCreationTokens ?? 0)
		summary.cacheBreaks += Number(row.cacheBreaks ?? 0)
		cacheHitRateSum += Number(row.cacheHitRate ?? 0)
		savingsSum += Number(row.estimatedSavingsPercent ?? 0)
		mergeBreaks(summary.cacheBreaksBySource, row.cacheBreaksBySource)
		summary.latestRows.push({
			timestamp: Number(row.timestamp ?? 0),
			taskId: String(row.taskId ?? ""),
			cacheHitRate: Number(row.cacheHitRate ?? 0),
			estimatedSavingsPercent: Number(row.estimatedSavingsPercent ?? 0),
			cacheReadTokens: Number(row.cacheReadTokens ?? 0),
			cacheCreationTokens: Number(row.cacheCreationTokens ?? 0),
		})
	}
}

summary.cacheHitRateAvg = summary.rows > 0 ? cacheHitRateSum / summary.rows : 0
summary.estimatedSavingsPercentAvg = summary.rows > 0 ? savingsSum / summary.rows : 0

summary.latestRows.sort((a, b) => a.timestamp - b.timestamp)
const latestRows = summary.latestRows.slice(-50)

const output = {
	...summary,
	cacheHitRateAvg: Number(summary.cacheHitRateAvg.toFixed(4)),
	estimatedSavingsPercentAvg: Number(summary.estimatedSavingsPercentAvg.toFixed(2)),
	latestRows,
}

let rendered
if (csvMode) {
	const header = [
		"timestamp",
		"taskId",
		"cacheHitRate",
		"estimatedSavingsPercent",
		"cacheReadTokens",
		"cacheCreationTokens",
	]
	const rows = latestRows.map((row) =>
		header.map((key) => JSON.stringify(row[key] ?? "")).join(","),
	)
	rendered = [header.join(","), ...rows].join("\n")
} else {
	rendered = JSON.stringify(output, null, 2)
}

if (outPath) {
	await writeFile(outPath, `${rendered}\n`, "utf8")
	console.log(`Wrote summary to ${outPath}`)
} else {
	console.log(rendered)
}
