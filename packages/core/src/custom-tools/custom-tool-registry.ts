/**
 * CustomToolRegistry - A reusable class for dynamically loading and managing TypeScript tools.
 *
 * Features:
 * - Dynamic TypeScript/JavaScript tool loading with esbuild transpilation.
 * - Pre-validation of source files to avoid executing non-tool code.
 * - Runtime validation of tool definitions.
 * - Tool execution with context.
 * - JSON Schema generation for LLM integration.
 */

import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import os from "os"
import { pathToFileURL } from "url"

import type { CustomToolDefinition, SerializedCustomToolDefinition, CustomToolParametersSchema } from "@njust-ai/types"

import type { StoredCustomTool, LoadResult } from "./types.js"
import { serializeCustomTool } from "./serialize.js"
import { logger } from "../shared/logger.js"
import { runEsbuild, NODE_BUILTIN_MODULES, COMMONJS_REQUIRE_BANNER } from "./esbuild-runner.js"

export interface RegistryOptions {
	/** Directory for caching compiled TypeScript files. */
	cacheDir?: string
	/** Additional paths for resolving node modules (useful for tools outside node_modules). */
	nodePaths?: string[]
	/** Path to the extension root directory (for finding bundled esbuild binary in production). */
	extensionPath?: string
}

export class CustomToolRegistry {
	private tools = new Map<string, StoredCustomTool>()
	private tsCache = new Map<string, string>()
	private cacheDir: string
	private nodePaths: string[]
	private extensionPath?: string
	private lastLoaded: Map<string, number> = new Map()

	constructor(options?: RegistryOptions) {
		this.cacheDir = options?.cacheDir ?? path.join(os.tmpdir(), "dynamic-tools-cache")
		this.nodePaths = options?.nodePaths ?? [path.join(process.cwd(), "node_modules")]
		this.extensionPath = options?.extensionPath
	}

	/**
	 * Pre-validate a source file before importing to check if it likely
	 * contains a valid custom tool definition. This prevents executing
	 * top-level code in files that don't match the expected pattern.
	 *
	 * Checks for:
	 * 1. An `export` keyword (ESM or CJS)
	 * 2. Key properties of a CustomToolDefinition (name, description, execute)
	 *
	 * This is a heuristic safety check, not a replacement for full validation.
	 *
	 * @param filePath - Absolute path to the source file
	 * @returns true if the file matches tool definition patterns
	 */
	private prevalidateSource(filePath: string): boolean {
		try {
			const source = fs.readFileSync(filePath, "utf-8")

			// Must contain an export statement (ESM or CJS).
			const hasExport =
				/\bexport\b/.test(source) || /\bmodule\.exports\b/.test(source) || /\bexports\./.test(source)

			if (!hasExport) {
				return false
			}

			// Must reference key tool definition properties.
			const hasName = /\bname\s*[):]/.test(source)
			const hasDescription = /\bdescription\s*:/.test(source)
			const hasExecute = /\bexecute\b/.test(source)

			return hasName && hasDescription && hasExecute
		} catch {
			// If we can't read the file, let the import attempt handle the error.
			return true
		}
	}

	/**
	 * Load all tools from a directory.
	 * Supports both .ts and .js files.
	 *
	 * @param toolDir - Absolute path to the tools directory
	 * @returns LoadResult with lists of loaded and failed tools
	 */
	async loadFromDirectory(toolDir: string): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		try {
			if (!fs.existsSync(toolDir)) {
				return result
			}

			const files = fs.readdirSync(toolDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"))

			for (const file of files) {
				const filePath = path.join(toolDir, file)

				try {
					// Pre-validate source before importing to avoid executing
					// top-level code in modules that don't resemble custom tools.
					if (!this.prevalidateSource(filePath)) {
						logger.info("CustomToolRegistry", `skipping ${filePath} — does not match custom tool pattern`)
						continue
					}

					logger.info("CustomToolRegistry", `importing tool from ${filePath}`)
					const mod = await this.import(filePath)

					for (const [exportName, value] of Object.entries(mod)) {
						const def = this.validate(exportName, value)

						if (!def) {
							continue
						}

						this.tools.set(def.name, { ...def, source: filePath })
						logger.info("CustomToolRegistry", `loaded tool ${def.name} from ${filePath}`)
						result.loaded.push(def.name)
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					logger.error("CustomToolRegistry", `import(${filePath}) failed: ${message}`)
					result.failed.push({ file, error: message })
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			logger.error("CustomToolRegistry", `loadFromDirectory(${toolDir}) failed: ${message}`)
		}

		return result
	}

	async loadFromDirectoryIfStale(toolDir: string): Promise<LoadResult> {
		if (!fs.existsSync(toolDir)) {
			return { loaded: [], failed: [] }
		}

		const lastLoaded = this.lastLoaded.get(toolDir)
		const stat = fs.statSync(toolDir)
		const isStale = lastLoaded ? stat.mtimeMs > lastLoaded : true

		if (isStale) {
			this.lastLoaded.set(toolDir, stat.mtimeMs)
			return this.loadFromDirectory(toolDir)
		}

		return { loaded: this.list(), failed: [] }
	}

	async loadFromDirectories(toolDirs: string[]): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		for (const toolDir of toolDirs) {
			const dirResult = await this.loadFromDirectory(toolDir)
			result.loaded.push(...dirResult.loaded)
			result.failed.push(...dirResult.failed)
		}

		return result
	}

	async loadFromDirectoriesIfStale(toolDirs: string[]): Promise<LoadResult> {
		const result: LoadResult = { loaded: [], failed: [] }

		for (const toolDir of toolDirs) {
			const dirResult = await this.loadFromDirectoryIfStale(toolDir)
			result.loaded.push(...dirResult.loaded)
			result.failed.push(...dirResult.failed)
		}

		return result
	}

	register(definition: CustomToolDefinition, source?: string): void {
		const { name: id } = definition
		const validated = this.validate(id, definition)

		if (!validated) {
			throw new Error(`Invalid tool definition for '${id}'`)
		}

		const storedTool: StoredCustomTool = source ? { ...validated, source } : validated
		this.tools.set(id, storedTool)
	}

	unregister(id: string): boolean {
		return this.tools.delete(id)
	}

	get(id: string): CustomToolDefinition | undefined {
		return this.tools.get(id)
	}

	has(id: string): boolean {
		return this.tools.has(id)
	}

	list(): string[] {
		return Array.from(this.tools.keys())
	}

	getAll(): CustomToolDefinition[] {
		return Array.from(this.tools.values())
	}

	getAllSerialized(): SerializedCustomToolDefinition[] {
		return this.getAll().map(serializeCustomTool)
	}

	get size(): number {
		return this.tools.size
	}

	clear(): void {
		this.tools.clear()
	}

	setExtensionPath(extensionPath: string): void {
		this.extensionPath = extensionPath
	}

	getExtensionPath(): string | undefined {
		return this.extensionPath
	}

	clearCache(): void {
		this.tsCache.clear()

		if (fs.existsSync(this.cacheDir)) {
			try {
				const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true })
				for (const entry of entries) {
					const entryPath = path.join(this.cacheDir, entry.name)
					if (entry.isDirectory()) {
						fs.rmSync(entryPath, { recursive: true, force: true })
					} else if (entry.name.endsWith(".mjs")) {
						fs.unlinkSync(entryPath)
					}
				}
			} catch (error) {
				logger.error(
					"CustomToolRegistry",
					`clearCache failed to clean disk cache: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	}

	private async import(filePath: string): Promise<Record<string, CustomToolDefinition>> {
		const absolutePath = path.resolve(filePath)
		const ext = path.extname(absolutePath)

		if (ext === ".js" || ext === ".mjs") {
			return import(pathToFileURL(absolutePath).href)
		}

		const stat = fs.statSync(absolutePath)
		const cacheKey = `${absolutePath}:${stat.mtimeMs}`

		if (this.tsCache.has(cacheKey)) {
			const cachedPath = this.tsCache.get(cacheKey)!
			return import(pathToFileURL(cachedPath).href)
		}

		const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 16)
		const toolCacheDir = path.join(this.cacheDir, hash)
		fs.mkdirSync(toolCacheDir, { recursive: true })

		const tempFile = path.join(toolCacheDir, "bundle.mjs")

		if (fs.existsSync(tempFile)) {
			this.tsCache.set(cacheKey, tempFile)
			return import(pathToFileURL(tempFile).href)
		}

		const toolDir = path.dirname(absolutePath)
		const toolNodeModules = path.join(toolDir, "node_modules")
		const nodePaths = fs.existsSync(toolNodeModules) ? [toolNodeModules, ...this.nodePaths] : this.nodePaths

		await runEsbuild(
			{
				entryPoint: absolutePath,
				outfile: tempFile,
				format: "esm",
				platform: "node",
				target: "node18",
				bundle: true,
				sourcemap: "inline",
				packages: "bundle",
				nodePaths,
				external: NODE_BUILTIN_MODULES,
				banner: COMMONJS_REQUIRE_BANNER,
			},
			this.extensionPath,
		)

		this.copyEnvFiles(toolDir, toolCacheDir)

		this.tsCache.set(cacheKey, tempFile)
		return import(pathToFileURL(tempFile).href)
	}

	private copyEnvFiles(toolDir: string, destDir: string): void {
		try {
			const files = fs.readdirSync(toolDir)
			const envFiles = files.filter((f) => f === ".env" || f.startsWith(".env."))

			for (const envFile of envFiles) {
				const srcPath = path.join(toolDir, envFile)
				const destPath = path.join(destDir, envFile)
				const stat = fs.statSync(srcPath)
				if (stat.isFile()) {
					fs.copyFileSync(srcPath, destPath)
				}
			}
		} catch (error) {
			logger.warn(
				"CustomToolRegistry",
				`failed to copy .env files: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private isParametersSchema(value: unknown): value is CustomToolParametersSchema {
		return (
			value !== null &&
			typeof value === "object" &&
			"_def" in value &&
			typeof (value as Record<string, unknown>)._def === "object"
		)
	}

	private validate(exportName: string, value: unknown): CustomToolDefinition | null {
		if (!value || typeof value !== "object") {
			return null
		}

		if (!("execute" in value) || typeof (value as Record<string, unknown>).execute !== "function") {
			return null
		}

		const obj = value as Record<string, unknown>
		const errors: string[] = []

		if (typeof obj.name !== "string") {
			errors.push("name: Expected string")
		} else if (obj.name.length === 0) {
			errors.push("name: Tool must have a non-empty name")
		}

		if (typeof obj.description !== "string") {
			errors.push("description: Expected string")
		} else if (obj.description.length === 0) {
			errors.push("description: Tool must have a non-empty description")
		}

		if (obj.parameters !== undefined && !this.isParametersSchema(obj.parameters)) {
			errors.push("parameters: parameters must be a Zod schema")
		}

		if (errors.length > 0) {
			throw new Error(`Invalid tool definition for '${exportName}': ${errors.join(", ")}`)
		}

		return value as CustomToolDefinition
	}
}

export const customToolRegistry = new CustomToolRegistry()
