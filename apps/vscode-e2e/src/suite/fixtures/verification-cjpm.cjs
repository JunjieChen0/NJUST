// Deterministic process fixture, not a compiler: real SDK coverage lives in the opt-in smoke suite.
/* global require, __dirname, process, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS process fixture. */
const fs = require("node:fs")
const path = require("node:path")

const args = process.argv.slice(2)
if (args.includes("--version")) {
	process.stdout.write("Cangjie E2E fixture 1.0\n")
} else {
	const control = JSON.parse(fs.readFileSync(path.join(__dirname, "control.json"), "utf8"))
	fs.appendFileSync(path.join(__dirname, "commands.jsonl"), JSON.stringify({ args, cwd: process.cwd() }) + "\n")
	setTimeout(() => {
		if (args[0] === "test") {
			const dir = args[args.indexOf("--report-path") + 1]
			fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(
				path.join(dir, "results.xml"),
				'<testsuite tests="1" failures="0" errors="0" skipped="0"/>',
			)
			process.stdout.write(
				"Summary: TOTAL: 1\n    PASSED: 1, SKIPPED: 0, ERROR: 0\n    FAILED: 0\ncjpm test success\n",
			)
		} else {
			process.stdout.write("cjpm build success\n")
		}
	}, control.delayMs ?? 0)
}
