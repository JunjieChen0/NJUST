import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CangjieTaskCase } from "./suite.js"

/** Evaluation fixtures must be ordinary files/directories, never links to another tree. */
async function assertUnlinkedPath(file: string): Promise<void> {
	const absolute = path.resolve(file)
	const parent = path.dirname(absolute)
	if (parent !== absolute) await assertUnlinkedPath(parent)
	try {
		const stat = await fs.lstat(absolute)
		if (stat.isSymbolicLink()) throw new Error(`Evaluation path contains a link: ${absolute}`)
		const actual = await fs.realpath(absolute)
		const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value)
		if (stat.isSymbolicLink() || normalize(actual) !== normalize(absolute))
			throw new Error(`Evaluation path contains a link or reparse point: ${absolute}`)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	}
}

async function assertProjectTree(root: string): Promise<void> {
	await assertUnlinkedPath(root)
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name)
		if (entry.isSymbolicLink()) throw new Error(`Evaluation project contains a link: ${file}`)
		if (entry.isDirectory()) await assertProjectTree(file)
		else if (!entry.isFile()) throw new Error(`Unsupported evaluation file: ${file}`)
	}
}

export async function copyEvaluationProject(source: string, destination: string): Promise<void> {
	await assertProjectTree(source)
	await assertUnlinkedPath(destination)
	await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true })
	await assertProjectTree(destination)
}

async function writeEvaluationFile(root: string, file: string, content: string): Promise<void> {
	const parts = file.split(/[\\/]/)
	if (
		path.isAbsolute(file) ||
		path.win32.isAbsolute(file) ||
		parts.some((part) => !part || part === ".." || part === "." || part.includes(":"))
	)
		throw new Error(`Invalid evaluation file path: ${file}`)
	const target = path.join(root, ...parts)
	await assertUnlinkedPath(target)
	await fs.mkdir(path.dirname(target), { recursive: true })
	await fs.writeFile(target, content)
}

/** Mutations are part of the versioned starting point, before the Agent sees the project. */
export async function prepareCase(task: CangjieTaskCase, root: string, variant?: string): Promise<void> {
	await assertProjectTree(root)
	if (task.initialFiles) {
		for (const [file, content] of Object.entries(task.initialFiles)) {
			await writeEvaluationFile(root, file, content)
		}
		return
	}
	const bounded = path.join(root, "src/bounded.cj")
	if (task.startingPoint === "compile-error")
		await fs.writeFile(bounded, 'package calculator\npublic func bounded(value: Int64): Int64 { "broken" }\n')
	if (task.startingPoint === "test-failure")
		await fs.writeFile(
			bounded,
			"package calculator\npublic func bounded(value: Int64): Int64 { if (value < 0) { -1 } else { value } }\n",
		)
	if (task.startingPoint === "dependency-interface") {
		const file = path.join(root, "src/order.cj")
		await fs.writeFile(file, (await fs.readFile(file, "utf8")).replaceAll("discountedSubtotal", "missingSubtotal"))
	}
	if (task.id === "CJ11")
		await fs.writeFile(
			path.join(root, "src/slow_test.cj"),
			`package calculator
import std.sync.*
import std.unittest.*
import std.unittest.testmacro.*
@Test class SlowTest {
    @TestCase func waits(): Unit { sleep(Duration.second * 20); @Expect(bounded(1), 1) }
}
`,
		)
	if (task.id === "CJ12" && variant === "dependency") {
		const file = path.join(root, "cjpm.toml")
		await fs.writeFile(
			file,
			(await fs.readFile(file, "utf8")).replace('path = "libs/pricing"', 'path = "libs/unavailable-pricing"'),
		)
	}
}

/** Additional tests are injected only into a separate final-project copy. */
export async function addOracle(task: CangjieTaskCase, root: string): Promise<void> {
	await assertProjectTree(root)
	if (task.oracleFiles) {
		for (const [file, content] of Object.entries(task.oracleFiles)) {
			await writeEvaluationFile(root, file, content)
		}
		return
	}
	const packageName = task.project === "minimal" ? "calculator" : "orders"
	let assertions: string[]
	if (task.project === "minimal") {
		assertions = [
			"@Expect(bounded(-20), 0)",
			"@Expect(bounded(0), 0)",
			"@Expect(bounded(7), 7)",
			"@Expect(bounded(100), 100)",
			`@Expect(bounded(101), ${task.id === "CJ02" || task.id === "CJ08" ? "100" : "101"})`,
		]
	} else {
		assertions = [
			"@Expect(orderTotal(100, 2), 700)",
			"@Expect(orderTotal(199, 9), 2291)",
			`@Expect(orderTotal(199, 10), ${task.id === "CJ05" ? "2291" : "2490"})`,
			`@Expect(orderTotal(101, 11), ${task.id === "CJ05" ? "1499" : "1611"})`,
			"@Expect(orderTotal(100, 0), 0)",
		]
	}
	await fs.writeFile(
		path.join(root, "src/eval_oracle_test.cj"),
		`package ${packageName}\nimport std.unittest.*\nimport std.unittest.testmacro.*\n@Test class EvaluationOracle {\n @TestCase func boundaries(): Unit {\n ${assertions.join("\n ")}\n }\n}\n`,
	)
}
