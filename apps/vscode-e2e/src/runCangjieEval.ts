import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { runTests } from "@vscode/test-electron"
import { CANGJIE_TASK_SUITE } from "../../../packages/evals/src/cangjie/suite.js"
import { contentFingerprint, inputFiles } from "../../../packages/evals/src/cangjie/artifacts.js"
import { prepareCase } from "../../../packages/evals/src/cangjie/projects.js"
import { scoreCangjieTask, type CangjieTaskEvidence } from "../../../packages/evals/src/cangjie/evidence.js"
import { createHash } from "node:crypto"
import { startMockServer } from "../../../packages/mock-api-server/src/runtime.js"

const execFileAsync = promisify(execFile)
let mockServer: Awaited<ReturnType<typeof startMockServer>> | undefined

interface ModelConfig {
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
	return { baseUrl: value.baseUrl, model: value.model, apiKeyEnv: value.apiKeyEnv }
}

async function main(): Promise<void> {
	const repo = path.resolve(process.cwd(), "../..")
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
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "njust-cangjie-eval-"))
	console.info(`Cangjie evaluation artifacts: ${root}`)
	const projects = path.join(repo, "packages/evals/cangjie/projects")
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
	if (!compilerVersion.includes(` ${CANGJIE_TASK_SUITE.sdkVersion} `))
		throw new Error(`SDK version mismatch: ${compilerVersion}`)
	if (!cjpmVersion.includes(CANGJIE_TASK_SUITE.sdkVersion)) throw new Error(`cjpm version mismatch: ${cjpmVersion}`)
	const version = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
	const sourceDiff = (
		await execFileAsync("git", ["diff", "HEAD", "--", "src", "webview-ui", "packages/types"], {
			cwd: repo,
			maxBuffer: 8 * 1024 * 1024,
		})
	).stdout
	await fs.writeFile(path.join(root, "source.patch"), sourceDiff)
	const untracked = (
		await execFileAsync(
			"git",
			["ls-files", "--others", "--exclude-standard", "--", "src", "webview-ui", "packages/types"],
			{ cwd: repo },
		)
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
		suiteVersion: CANGJIE_TASK_SUITE.version,
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
						...["suite", "evidence", "artifacts", "projects"].map((name) =>
							path.resolve(__dirname, `../../../packages/evals/src/cangjie/${name}.js`),
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
		model: config?.model ?? null,
		modelEndpoint: config?.baseUrl ?? null,
		execution,
		concurrency: 1,
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
	for (const project of ["minimal", "orders"] as const) {
		const destination = path.join(root, "sdk-check", project)
		await fs.cp(path.join(projects, project), destination, { recursive: true })
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
	await fs.writeFile(path.join(root, "suite.json"), JSON.stringify(CANGJIE_TASK_SUITE, null, 2))
	if (!config) {
		await fs.writeFile(
			path.join(root, "report.json"),
			JSON.stringify(
				{
					execution: "sdk-regression",
					independentAgentSuccesses: 0,
					agentBaseline: "not-run",
					reason: "No real model configuration provided",
					tasks: CANGJIE_TASK_SUITE.cases.map((task) => ({ caseId: task.id, status: "not-run" })),
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
	if (selected?.some((id) => !CANGJIE_TASK_SUITE.cases.some((task) => task.id === id)))
		throw new Error("Unknown evaluation case selected")
	const scores: ReturnType<typeof scoreCangjieTask>[] = []
	for (const task of CANGJIE_TASK_SUITE.cases.filter((item) => !selected || selected.includes(item.id))) {
		if (mockServer && task.id !== "CJ02" && task.id !== "CJ05")
			throw new Error(
				"The deterministic project regression supports only CJ02 and CJ05; it is not the genuine 12-task baseline",
			)
		const variants = task.id === "CJ12" ? ["sdk", "dependency"] : [undefined]
		const evidence: CangjieTaskEvidence[] = []
		for (const variant of variants) {
			const label = `${task.id}${variant ? `-${variant}` : ""}`
			const workspace = path.join(root, "workspaces", label)
			await fs.cp(path.join(projects, task.project), workspace, { recursive: true })
			await prepareCase(task, workspace, variant)
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
		const combined: CangjieTaskEvidence = {
			...evidence[0]!,
			modelResponseObserved: evidence.every((item) => item.modelResponseObserved),
			assertions: evidence.flatMap((item) => item.assertions),
			interventions: evidence.flatMap((item) => item.interventions),
			violations: evidence.flatMap((item) => item.violations),
			outcome:
				evidence.find((item) => item.outcome === "failed" || item.outcome === "timeout")?.outcome ??
				evidence[0]!.outcome,
		}
		scores.push(scoreCangjieTask(task, combined))
	}
	const report = {
		...metadata,
		agentBaseline: execution === "real-agent" ? scores.every((score) => score.modelResponseObserved) ? "executed" : "incomplete" : "not-run",
		suiteComplete: scores.length === 12,
		safetyGate:
			scores.length === 12 &&
			scores.every((score) => score.safetyPassed) &&
			CANGJIE_TASK_SUITE.cases
				.filter((task) => task.category === "safety")
				.every((task) => scores.some((score) => score.caseId === task.id && score.passed))
				? "passed"
				: "not-passed",
		independentAgentSuccesses: scores.filter((score) => score.independentAgentSuccess).length,
		tasks: scores,
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
