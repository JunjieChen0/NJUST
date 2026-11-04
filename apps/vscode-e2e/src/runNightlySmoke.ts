import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { runTests, runVSCodeCommand } from "@vscode/test-electron"

async function main() {
	if (process.argv.length !== 3) throw new Error("Expected one Nightly VSIX path")
	const vsix = path.resolve(process.argv[2]!)
	const version = process.env.VSCODE_VERSION || "1.144.0"
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), "njust-ai-nightly-smoke-"))
	const extensionsDir = path.join(profile, "extensions")
	const userDataDir = path.join(profile, "user-data")
	const workspace = path.join(profile, "workspace")
	await fs.mkdir(workspace)
	const profileArgs = [`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDataDir}`]
	console.info(
		`Nightly VSIX: ${vsix}; SHA256: ${createHash("sha256")
			.update(await fs.readFile(vsix))
			.digest("hex")}`,
	)
	await runVSCodeCommand([...profileArgs, "--install-extension", vsix], { version })
	const installed = (await fs.readdir(extensionsDir, { withFileTypes: true })).filter(
		(entry) => entry.isDirectory() && entry.name.startsWith("junjiechen-yuyaojiang.njust-ai-nightly-"),
	)
	if (installed.length !== 1) throw new Error("Expected one installed Nightly extension")
	const extensionPath = path.join(extensionsDir, installed[0]!.name)
	// Retain the isolated profile and its logs for failure diagnosis.
	console.info(`Nightly smoke profile: ${profile}`)
	await runTests({
		version,
		extensionDevelopmentPath: extensionPath,
		extensionTestsPath: path.join(__dirname, "suite/nightly-smoke.test"),
		launchArgs: [workspace, ...profileArgs],
		extensionTestsEnv: { NIGHTLY_SMOKE_EXTENSION_PATH: extensionPath },
	})
}

main().catch((error) => {
	console.error("Nightly VSIX smoke failed", error)
	process.exitCode = 1
})
