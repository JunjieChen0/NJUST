// Solid Build Script - Plain JS (no TypeScript)
// Pre-compiles Solid JSX files using Babel before tsup bundles.

import { transformAsync } from "@babel/core"
import { readdir, readFile, writeFile, mkdir } from "fs/promises"
import path from "path"

const SRC_DIR = path.join(process.cwd(), "src", "tui")
const OUT_DIR = path.join(process.cwd(), "src", "tui", "dist")

async function findTsxFiles(dir) {
	const files = []
	const entries = await readdir(dir, { withFileTypes: true })

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "dist" || entry.name === "__tests__") continue
			files.push(...(await findTsxFiles(fullPath)))
		} else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
			files.push(fullPath)
		}
	}

	return files
}

async function compileSolidFile(srcPath, outDir) {
	const code = await readFile(srcPath, "utf-8")

	const result = await transformAsync(code, {
		filename: srcPath,
		presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
		plugins: [
			[
				"babel-plugin-jsx-dom-expressions",
				{
					moduleName: "@opentui/solid",
					builtIns: [],
					contextToCustomElements: false,
					wrapConditionals: false,
					generate: "universal",
				},
			],
		],
	})

	if (!result || !result.code) {
		throw new Error("Babel transform failed for " + srcPath)
	}

	const relativePath = path.relative(SRC_DIR, srcPath)
	const outPath = path
		.join(outDir, relativePath)
		.replace(/\.tsx$/, ".js")
		.replace(/\.ts$/, ".js")

	await mkdir(path.dirname(outPath), { recursive: true })
	await writeFile(outPath, result.code, "utf-8")
	console.log("  OK " + relativePath + " -> " + path.relative(SRC_DIR, outPath))
}

async function main() {
	console.log("[solid-build] Compiling Solid JSX files...")

	try {
		const files = await findTsxFiles(SRC_DIR)
		console.log("[solid-build] Found " + files.length + " files to compile")

		for (const file of files) {
			await compileSolidFile(file, OUT_DIR)
		}

		console.log(
			"[solid-build] Done: compiled " + files.length + " files to " + path.relative(process.cwd(), OUT_DIR),
		)
	} catch (err) {
		console.error("[solid-build] Error:", err instanceof Error ? err.message : String(err))
		process.exit(1)
	}
}

main()
