import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { runTests } from "@vscode/test-electron"
import type { CangjieTaskCase } from "../../../packages/evals/src/cangjie/suite.js"
import { loadCangjieTaskSuite } from "../../../packages/evals/src/cangjie/suiteLoader.js"
import { summarizeCangjieScores } from "../../../packages/evals/src/cangjie/report.js"
import { prepareWindowsTestEnvironment } from "./cangjie-eval/windowsTestEnvironment.js"
import { contentFingerprint, inputFiles } from "../../../packages/evals/src/cangjie/artifacts.js"
import { copyEvaluationProject, prepareCase } from "../../../packages/evals/src/cangjie/projects.js"
import {
	scoreCangjieTask,
	scoreCangjieTaskVariants,
	type CangjieTaskEvidence,
} from "../../../packages/evals/src/cangjie/evidence.js"
import { createHash } from "node:crypto"
import { startMockServer } from "../../../packages/mock-api-server/src/runtime.js"

const execFileAsync = promisify(execFile)
let mockServer: Awaited<ReturnType<typeof startMockServer>> | undefined

interface ModelConfig {
	provider?: "openai" | "deepseek" | "doubao"
	baseUrl: string
	model: string
	apiKeyEnv: string
}

function parseModelConfig(value: unknown): ModelConfig {
	if (
		!value ||
		typeof value !== "object" ||
		!("baseUrl" in value) ||
		!("model" in value) ||
		!("apiKeyEnv" in value) ||
		typeof value.baseUrl !== "string" ||
		typeof value.model !== "string" ||
		typeof value.apiKeyEnv !== "string"
	)
		throw new Error("Model config requires baseUrl, model and apiKeyEnv; never put a literal API key in the config")
	const url = new URL(value.baseUrl)
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search)
		throw new Error("Use an HTTP(S) base URL without embedded credentials or query parameters")
	const provider = "provider" in value ? value.provider : "openai"
	if (provider !== "openai" && provider !== "deepseek" && provider !== "doubao")
		throw new Error("Unsupported evaluation provider")
	return { baseUrl: value.baseUrl, model: value.model, apiKeyEnv: value.apiKeyEnv, provider }
}

async function main(): Promise<void> {
	const repo = path.resolve(process.cwd(), "../..")
	const loaded = await loadCangjieTaskSuite(repo, process.env.NJUST_CANGJIE_EVAL_SUITE)
	const { suite } = loaded
	const projects = process.env.NJUST_CANGJIE_EVAL_PROJECTS ?? loaded.projects
	const sdkHome = process.env.CANGJIE_HOME
	if (!sdkHome) throw new Error("Set CANGJIE_HOME to the SDK to evaluate; expected SDK 1.0.5")
	const configPath = process.env.NJUST_CANGJIE_EVAL_CONFIG
	if (process.env.NJUST_CANGJIE_EVAL_MOCK === "1") mockServer = await startMockServer({ port: 0 })
	if (mockServer) process.env.NJUST_CANGJIE_MOCK_KEY = "mock-key"
	const config = mockServer
		? { baseUrl: `${mockServer.url}/v1`, model: "mock-model", apiKeyEnv: "NJUST_CANGJIE_MOCK_KEY" }
		: configPath
			? parseModelConfig(JSON.parse(await fs.readFile(configPath, "utf8")))
			: undefined
	const extensionPath = process.env.NJUST_CANGJIE_EVAL_EXTENSION_PATH ?? path.join(repo, "src")
	const outputParent = process.env.NJUST_CANGJIE_EVAL_OUTPUT ?? os.tmpdir()
	await fs.mkdir(outputParent, { recursive: true })
	const root = await fs.mkdtemp(path.join(await fs.realpath(outputParent), "njust-cangjie-eval-"))
	console.info(`Cangjie evaluation artifacts: ${root}`)
	const executable = process.platform === "win32" ? ".exe" : ""
	const sdkEnv: NodeJS.ProcessEnv = {}
	for (const key of ["SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG"]) {
		if (process.env[key]) sdkEnv[key] = process.env[key]
	}
	const runtime = path.join(
		sdkHome,
		"runtime/lib",
		process.platform === "win32"
			? "windows_x86_64_llvm"
			: process.platform === "darwin"
				? `darwin_${process.arch === "arm64" ? "aarch64" : "x86_64"}_llvm`
				: "linux_x86_64_llvm",
	)
	sdkEnv.CANGJIE_HOME = sdkHome
	sdkEnv.PATH = [
		path.join(sdkHome, "bin"),
		path.join(sdkHome, "tools/bin"),
		path.join(sdkHome, "tools/lib"),
		runtime,
		process.env.PATH ?? process.env.Path ?? "",
	].join(path.delimiter)
	if (process.platform === "darwin") sdkEnv.DYLD_LIBRARY_PATH = runtime
	else if (process.platform !== "win32") sdkEnv.LD_LIBRARY_PATH = runtime
	const compiler = path.join(sdkHome, "bin", `cjc${executable}`)
	const cjpm = path.join(sdkHome, "tools/bin", `cjpm${executable}`)
	const compilerVersion = (await execFileAsync(compiler, ["--version"], { env: sdkEnv })).stdout.trim()
	const cjpmVersion = (await execFileAsync(cjpm, ["--version"], { env: sdkEnv })).stdout.trim()
	if (!compilerVersion.includes(` ${suite.sdkVersion} `)) throw new Error(`SDK version mismatch: ${compilerVersion}`)
	if (!cjpmVersion.includes(suite.sdkVersion)) throw new Error(`cjpm version mismatch: ${cjpmVersion}`)
	const version = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
	const sourcePaths = ["src", "webview-ui", "packages", "apps/vscode-e2e"]
	const sourceDiff = (
		await execFileAsync("git", ["diff", "HEAD", "--", ...sourcePaths], {
			cwd: repo,
			maxBuffer: 8 * 1024 * 1024,
		})
	).stdout
	await fs.writeFile(path.join(root, "source.patch"), sourceDiff)
	const untracked = (
		await execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "--", ...sourcePaths], { cwd: repo })
	).stdout
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
	const untrackedInputs = Object.fromEntries(
		await Promise.all(untracked.map(async (file) => [file, await fs.readFile(path.join(repo, file), "utf8")])),
	)
	await fs.writeFile(path.join(root, "source-untracked.json"), JSON.stringify(untrackedInputs))
	const bundleHash = createHash("sha256")
		.update(await fs.readFile(path.join(extensionPath, "dist/extension.js")))
		.digest("hex")
	let baselineRevision: string | undefined
	if (process.env.NJUST_CANGJIE_EVAL_EXTENSION_PATH)
		baselineRevision = JSON.parse(
			await fs.readFile(path.join(extensionPath, "baseline-metadata.json"), "utf8"),
		).sourceRevision
	const execution: CangjieTaskEvidence["execution"] = mockServer
		? "mock-regression"
		: config
			? "real-agent"
			: "sdk-regression"
	const metadata = {
		suiteVersion: suite.version,
		suiteHash: contentFingerprint({ suite: JSON.stringify(suite) }),
		sdk: compilerVersion,
		cjpmVersion,
		nodeVersion: process.version,
		lockfileHash: createHash("sha256")
			.update(await fs.readFile(path.join(repo, "pnpm-lock.yaml")))
			.digest("hex"),
		evaluatorHash: contentFingerprint(
			Object.fromEntries(
				await Promise.all(
					[
						__filename,
						path.join(__dirname, "cangjie-eval/index.js"),
						path.join(__dirname, "cangjie-eval/windowsTestEnvironment.js"),
						...["suite", "suiteLoader", "report", "reportFacts", "evidence", "artifacts", "projects"].map(
							(name) => path.resolve(__dirname, `../../../packages/evals/src/cangjie/${name}.js`),
						),
					].map(async (file) => [path.basename(file), await fs.readFile(file, "utf8")]),
				),
			),
		),
		platform: process.platform,
		sourceRevision: baselineRevision ?? version,
		sourceDiffHash: contentFingerprint({ diff: sourceDiff, ...untrackedInputs }),
		extensionPath,
		bundleHash,
		projectFingerprints: {} as Record<string, string>,
		provider: config && "provider" in config ? config.provider : "openai",
		model: config?.model ?? null,
		modelEndpoint: config?.baseUrl ?? null,
		execution,
		concurrency: 1,
		testCommunication: await prepareWindowsTestEnvironment(root, suite),
		performanceThreshold: null,
	}
	const checks: {
		project: string
		executable: string
		args: string[]
		cwd: string
		exitCode: number | null
		startedAt: number
		endedAt: number
		inputFingerprint: string
		inputFingerprintAfter: string
		log: string
	}[] = []
	for (const project of new Set(suite.cases.map((task) => task.project))) {
		const destination = path.join(root, "sdk-check", project)
		await copyEvaluationProject(path.join(projects, project), destination)
		metadata.projectFingerprints[project] = contentFingerprint(await inputFiles(destination))
		for (const command of ["build", "test"] as const) {
			const startedAt = Date.now()
			const args = command === "test" ? ["test", "--no-color", "--no-progress"] : [command]
			let exitCode: number | null = 0
			let output: string
			try {
				const result = await execFileAsync(cjpm, args, {
					cwd: destination,
					env: sdkEnv,
					timeout: 120_000,
					maxBuffer: 4 * 1024 * 1024,
				})
				output = result.stdout + result.stderr
			} catch (error) {
				const failed = error as Error & { code?: number; stdout?: string; stderr?: string }
				exitCode = typeof failed.code === "number" ? failed.code : null
				output = `${failed.stdout ?? ""}${failed.stderr ?? ""}\n${failed.message}`
			}
			const log = `${project}-${command}.log`
			await fs.writeFile(path.join(root, log), output)
			checks.push({
				project,
				executable: cjpm,
				args,
				cwd: destination,
				exitCode,
				startedAt,
				endedAt: Date.now(),
				inputFingerprint: metadata.projectFingerprints[project],
				inputFingerprintAfter: contentFingerprint(await inputFiles(destination)),
				log,
			})
		}
	}
	await fs.writeFile(path.join(root, "environment.json"), JSON.stringify(metadata, null, 2))
	await fs.writeFile(path.join(root, "sdk-checks.json"), JSON.stringify(checks, null, 2))
	await fs.writeFile(path.join(root, "suite.json"), JSON.stringify(suite, null, 2))
	if (!config) {
		await fs.writeFile(
			path.join(root, "report.json"),
			JSON.stringify(
				{
					execution: "sdk-regression",
					independentAgentSuccesses: 0,
					agentBaseline: "not-run",
					reason: "No real model configuration provided",
					tasks: suite.cases.map((task) => ({ caseId: task.id, status: "not-run" })),
				},
				null,
				2,
			),
		)
		console.info("SDK checks only. Genuine Agent baseline is not run and no success rate is claimed.")
		if (checks.some((check) => check.exitCode !== 0 || check.inputFingerprint !== check.inputFingerprintAfter))
			process.exitCode = 2
		return
	}
	if (!config.baseUrl || !config.model || !config.apiKeyEnv || !process.env[config.apiKeyEnv])
		throw new Error(
			"Real model config requires baseUrl, model and apiKeyEnv naming a configured environment variable",
		)
	const selected = process.env.NJUST_CANGJIE_EVAL_CASES?.split(",") ?? (mockServer ? ["CJ02", "CJ05"] : undefined)
	if (selected?.some((id) => !suite.cases.some((task) => task.id === id)))
		throw new Error("Unknown evaluation case selected")
	const scores: ReturnType<typeof scoreCangjieTask>[] = []
	const tasks: readonly CangjieTaskCase[] = suite.cases.filter((item) => !selected || selected.includes(item.id))
	for (const task of tasks) {
		console.info(`Starting ${task.id} (${task.category})`)
		if (mockServer && task.id !== "CJ02" && task.id !== "CJ05")
			throw new Error(
				"The deterministic project regression supports only CJ02 and CJ05; it is not the genuine 12-task baseline",
			)
		const variants = task.variants ? Object.keys(task.variants) : [undefined]
		const evidence: CangjieTaskEvidence[] = []
		for (const variant of variants) {
			const label = `${task.id}${variant ? `-${variant}` : ""}`
			const workspace = path.join(root, "workspaces", label)
			await copyEvaluationProject(path.join(projects, task.project), workspace)
			await prepareCase(task, workspace, variant)
			// Keep search tools from inheriting ignore rules from a parent repository.
			await execFileAsync("git", ["init", "--quiet"], { cwd: workspace })
			const initial: { buildFailed?: boolean; testFailed?: boolean; inputFingerprint: string } = {
				inputFingerprint: contentFingerprint(await inputFiles(workspace)),
			}
			if (task.startingPoint !== "clean") {
				const command = task.startingPoint === "test-failure" ? "test" : "build"
				try {
					const result = await execFileAsync(cjpm, [command], {
						cwd: workspace,
						env: sdkEnv,
						timeout: 120_000,
					})
					await fs.writeFile(path.join(root, `${label}-initial.log`), result.stdout + result.stderr)
				} catch (error) {
					const failed = error as Error & { code?: number; stdout?: string; stderr?: string }
					if (typeof failed.code === "number" && failed.code !== 0) {
						if (command === "build") initial.buildFailed = true
						else initial.testFailed = true
					}
					await fs.writeFile(
						path.join(root, `${label}-initial.log`),
						`${failed.stdout ?? ""}${failed.stderr ?? ""}\n${failed.message}`,
					)
				}
			}
			await fs.writeFile(path.join(root, `${label}-initial.json`), JSON.stringify(initial, null, 2))
			const input = path.join(root, `${label}-input.json`)
			await fs.writeFile(
				input,
				JSON.stringify({
					root,
					workspace,
					config,
					caseId: task.id,
					task,
					variant,
					sdkEnv,
					cjpm,
					compiler,
					execution,
				}),
			)
			try {
				await runTests({
					extensionDevelopmentPath: extensionPath,
					extensionTestsPath: path.resolve(__dirname, "cangjie-eval/index"),
					launchArgs: [
						workspace,
						"--user-data-dir",
						path.join(root, "profiles", label),
						"--extensions-dir",
						path.join(root, "profiles", label, "extensions"),
						"--disable-workspace-trust",
					],
					extensionTestsEnv: {
						...sdkEnv,
						ELECTRON_RUN_AS_NODE: undefined,
						[config.apiKeyEnv]: process.env[config.apiKeyEnv],
						NJUST_CANGJIE_EVAL_INPUT: input,
					},
					...(process.env.VSCODE_EXECUTABLE_PATH
						? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
						: { version: process.env.VSCODE_VERSION ?? "1.144.0" }),
				})
				evidence.push(JSON.parse(await fs.readFile(path.join(root, label, "evidence.json"), "utf8")))
			} catch (error) {
				console.error(
					`${label} failed: ${String(error).replaceAll(process.env[config.apiKeyEnv]!, "[REDACTED]")}`,
				)
			}
		}
		if (task.variants) {
			scores.push(scoreCangjieTaskVariants(task, evidence))
			continue
		}
		if (evidence.length !== variants.length) {
			scores.push({
				caseId: task.id,
				passed: false,
				independentAgentSuccess: false,
				modelResponseObserved: false,
				manualCodeAssistance: false,
				approvalCount: evidence
					.flatMap((item) => item.interventions)
					.filter((event) => event.kind === "approval").length,
				missingAssertions: [...task.requiredAssertions],
				artifactsComplete: false,
				safetyPassed: false,
				failureReason: "Missing Extension Host evidence",
			})
			continue
		}
		scores.push(scoreCangjieTask(task, evidence[0]!))
	}
	const report = {
		...metadata,
		...summarizeCangjieScores(suite, execution, scores),
	}
	await fs.writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2))
	if (scores.some((score) => !score.passed)) process.exitCode = 2
}

void main()
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.name + ": " + error.message : "Evaluation failed")
		process.exitCode = 1
	})
	.finally(async () => {
		await mockServer?.close()
	})
