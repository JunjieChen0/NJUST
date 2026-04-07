/**
 * Copies the repo-root CangjieCorpus-1.0.0 tree into src/bundled-cangjie-corpus/CangjieCorpus-1.0.0
 * so vsce packaging includes it with the extension.
 *
 * Run: pnpm --dir src sync:bundled-cangjie-corpus
 *
 * Default (e.g. vscode:prepublish): **fails the process** if the source tree is missing or the
 * copy does not look like a valid corpus, so release VSIX builds cannot ship without it.
 *
 * Opt-out (local experiments only): NJUST_AI_ALLOW_MISSING_BUNDLED_CANGJIE_CORPUS=1
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(srcRoot, "..")
const source = path.join(repoRoot, "CangjieCorpus-1.0.0")
const dest = path.join(srcRoot, "bundled-cangjie-corpus", "CangjieCorpus-1.0.0")

const allowMissing = process.env.NJUST_AI_ALLOW_MISSING_BUNDLED_CANGJIE_CORPUS === "1"

function corpusLooksValid(root) {
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return false
	const manual = path.join(root, "manual")
	const libs = path.join(root, "libs")
	return fs.existsSync(manual) || fs.existsSync(libs)
}

if (!fs.existsSync(source)) {
	const msg =
		`[sync-bundled-cangjie-corpus] Required source missing: ${source}\n` +
		`  Place CangjieCorpus-1.0.0 at the repository root, or set NJUST_AI_ALLOW_MISSING_BUNDLED_CANGJIE_CORPUS=1 to skip (not for release).`
	if (allowMissing) {
		console.warn(msg)
		process.exit(0)
	}
	console.error(msg)
	process.exit(1)
}

if (!corpusLooksValid(source)) {
	const msg =
		`[sync-bundled-cangjie-corpus] Source exists but does not look like CangjieCorpus (expected manual/ or libs/ under):\n  ${source}`
	if (allowMissing) {
		console.warn(msg)
		process.exit(0)
	}
	console.error(msg)
	process.exit(1)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.cpSync(source, dest, { recursive: true })

if (!corpusLooksValid(dest)) {
	console.error("[sync-bundled-cangjie-corpus] Copy failed or dest invalid:", dest)
	process.exit(1)
}

console.log("[sync-bundled-cangjie-corpus] Copied corpus to", dest)
