#!/usr/bin/env node

/**
 * Lightweight secrets scanner.
 *
 * Three input modes (chosen by CLI flag):
 *   --all-files  scan every git-tracked file (CI use; full repo)
 *   --staged     scan only files staged for commit (pre-commit hook)
 *   (default)    read newline-separated file list from stdin
 *
 * Returns exit code 1 if potential secrets are found.
 */

import { readFileSync } from "fs"
import { execSync } from "child_process"
import { createInterface } from "readline"

// Patterns that indicate potential secrets.
// SINGLE SOURCE OF TRUTH (runtime): packages/core/src/security/secretPatterns.ts
// This list MUST stay in sync with the TypeScript module above.
// A Vitest test in packages/core enforces this invariant.
const SECRET_PATTERNS = [
	// Private keys
	{ pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, name: "Private key" },
	// Cloud provider keys
	{ pattern: /AKIA[0-9A-Z]{16}/, name: "AWS access key" },
	// GitHub tokens
	{ pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub personal access token" },
	{ pattern: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth token" },
	{ pattern: /ghs_[a-zA-Z0-9]{36}/, name: "GitHub server-to-server token" },
	{ pattern: /github_pat_[a-zA-Z0-9]{22,}/, name: "GitHub PAT" },
	// OpenAI / xAI
	{ pattern: /sk-[a-zA-Z0-9]{20,}/, name: "OpenAI API key (sk-...)" },
	{ pattern: /pk-[a-zA-Z0-9]{20,}/, name: "OpenAI public key (pk-...)" },
	{ pattern: /xai-[a-zA-Z0-9]{20,}/, name: "xAI API key" },
	// Anthropic
	{ pattern: /ant-api[a-zA-Z0-9_-]{20,}/i, name: "Anthropic API key" },
	// Slack
	{ pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?/, name: "Slack token" },
	// JWT
	{ pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/, name: "JWT token" },
	// Generic key-value patterns
	{ pattern: /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/i, name: "JSON API key" },
	{ pattern: /password\s*[:=]\s*["'][^"']{8,}["']/i, name: "Password" },
	{ pattern: /secret\s*[:=]\s*["'][^"']{8,}["']/i, name: "Hard-coded secret" },
	{ pattern: /token\s*[:=]\s*["'][^"']{8,}["']/i, name: "Hard-coded token" },
	// .env files with secrets (fileName guard applied below)
	{ pattern: /^[A-Z_]+=/m, fileName: /\.env$/, name: "Environment variable in .env file" },
]

const patterns = SECRET_PATTERNS

/**
 * Strip lines marked with `// gitleaks:allow` or `# gitleaks:allow` from
 * `content` before pattern matching. This is the canonical inline allowlist
 * convention used by gitleaks itself; mirroring it in the local scanner means
 * test fixtures can self-document each fake credential without requiring a
 * blanket file-level skip.
 */
function stripGitleaksAllowLines(content) {
	return content
		.split(/\r?\n/)
		.filter((line) => !/(?:\/\/|#)\s*gitleaks:allow\b/.test(line))
		.join("\n")
}

// Obviously-fake key shapes that test fixtures use to exercise the matcher
// without committing real credentials. Mirrors the `[allowlist].regexes` block
// in `.gitleaks.toml` — keep both lists in sync.
const OBVIOUSLY_FAKE_REGEXES = [
	/sk-test-[a-zA-Z0-9]+/,
	/test-api-key-[a-zA-Z0-9]+/,
	/mock-token-[a-zA-Z0-9]+/,
	/ghp_TEST[a-zA-Z0-9]+/,
	/AKIA[A-Z0-9]{0,15}EXAMPLE/,
	// Common fixture placeholders in unit tests
	/sk-(?:fake|dummy|example|placeholder)[-a-zA-Z0-9]*/i,
	/ghp_[xX]{36}/, // ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
]

/** True if every occurrence of `pattern` inside `content` is an obvious fake. */
function allMatchesAreObviouslyFake(content, pattern) {
	const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
	const globalPattern = new RegExp(pattern.source, flags)
	const matches = content.match(globalPattern)
	if (!matches || matches.length === 0) return false
	return matches.every((m) => OBVIOUSLY_FAKE_REGEXES.some((fake) => fake.test(m)))
}

const ALLOWLISTED_FINDINGS = [
	{
		file: /^\.njust-ai\/skills\/cangjie-full-docs\/libs_stdx\/logger\/logger_samples\/logger_sample\.md$/,
		name: "Password",
	},
	{ file: /^CangjieCorpus-1\.0\.0\/libs\/stdx\/logger\/logger_samples\/logger_sample\.md$/, name: "Password" },
	{ file: /^src\/utils\/__tests__\/git\.spec\.ts$/, name: "GitHub personal access token" },
	{ file: /^webview-ui\/src\/i18n\/locales\/(?:en|zh-CN|zh-TW)\/settings\.json$/, name: "JSON API key" },
	{
		file: /^src\/core\/tools\/permissions\/__tests__\/BashCommandAnalyzer\.spec\.ts$/,
		name: "GitHub personal access token",
	},
	{ file: /^src\/core\/tools\/permissions\/__tests__\/BashCommandAnalyzer\.spec\.ts$/, name: "AWS access key" },
	{ file: /^src\/core\/tools\/permissions\/__tests__\/BashCommandAnalyzer\.spec\.ts$/, name: "Private key" },
	{ file: /^src\/core\/tools\/permissions\/__tests__\/BashCommandAnalyzer\.spec\.ts$/, name: "Password" },
	// Source files with property references that match "JSON API key" pattern (false positives)
	{ file: /^apps\/cli\/src\/commands\/cli\/run\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/qwen-code\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/config\/ContextProxy\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/webview\/handlers\/settingsMessageHandler\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/code-index\/config-manager\.ts$/, name: "JSON API key" },
	{ file: /^webview-ui\/src\/components\/modes\/ModesView\.tsx$/, name: "JSON API key" },
	{ file: /^webview-ui\/src\/components\/settings\/ApiOptions\.tsx$/, name: "JSON API key" },

	// ── Tests that exercise pattern-matching / config-handling logic with
	//    fake-but-realistic-looking credentials. Each entry is per file +
	//    per pattern name; adding another pattern accidentally still trips.
	{ file: /^apps\/cli\/src\/lib\/storage\/__tests__\/credentials\.test\.ts$/, name: "Hard-coded token" },
	{ file: /^apps\/cli\/src\/lib\/utils\/__tests__\/provider\.test\.ts$/, name: "JSON API key" },
	{
		file: /^packages\/core\/src\/security\/__tests__\/secretPatterns\.spec\.ts$/,
		name: "GitHub personal access token",
	},
	{ file: /^src\/__tests__\/testConstants\.ts$/, name: "GitHub personal access token" },
	{ file: /^src\/__tests__\/testConstants\.ts$/, name: "OpenAI API key (sk-...)" },
	{ file: /^src\/api\/providers\/__tests__\/fireworks\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/__tests__\/minimax\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/__tests__\/qwen-code-native-tools\.spec\.ts$/, name: "Hard-coded token" },
	{ file: /^src\/api\/providers\/__tests__\/sambanova\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/__tests__\/zai\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/fetchers\/__tests__\/modelCache\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/api\/providers\/utils\/__tests__\/image-generation\.spec\.ts$/, name: "Hard-coded token" },
	{ file: /^src\/core\/config\/__tests__\/ContextProxy\.additional\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/config\/__tests__\/ContextProxy\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/config\/__tests__\/ProviderSettingsManager\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/webview\/__tests__\/ClineProvider\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/core\/webview\/__tests__\/webviewMessageHandler\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/integrations\/terminal\/__tests__\/OutputInterceptor\.test\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/cloud-agent\/__tests__\/ProfileStorageService\.spec\.ts$/, name: "Hard-coded token" },
	{ file: /^src\/services\/cloud-agent\/__tests__\/RestProtocolAdapter\.spec\.ts$/, name: "Hard-coded token" },
	{ file: /^src\/services\/code-index\/__tests__\/config-manager\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/code-index\/__tests__\/service-factory\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/code-index\/embedders\/__tests__\/gemini\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/code-index\/embedders\/__tests__\/mistral\.spec\.ts$/, name: "JSON API key" },
	{ file: /^src\/services\/code-index\/embedders\/__tests__\/vercel-ai-gateway\.spec\.ts$/, name: "JSON API key" },
	{
		file: /^webview-ui\/src\/components\/settings\/__tests__\/ImageGenerationSettings\.spec\.tsx$/,
		name: "JSON API key",
	},
]

function normalizePath(file) {
	return file.replaceAll("\\", "/")
}

function isAllowlisted(file, name) {
	const normalized = normalizePath(file)
	return ALLOWLISTED_FINDINGS.some((entry) => entry.name === name && entry.file.test(normalized))
}

async function main() {
	const isAllFiles = process.argv.includes("--all-files")
	const isStaged = process.argv.includes("--staged")
	const files = []

	// Human-readable label for log messages, so CI logs say "all files" /
	// "staged files" / "input file list" depending on the actual mode.
	const scopeLabel = isAllFiles ? "all tracked files" : isStaged ? "staged files" : "input file list"

	if (isAllFiles) {
		try {
			const output = execSync("git ls-files", { encoding: "utf-8", stdio: "pipe" })
			files.push(...output.trim().split("\n").filter(Boolean))
		} catch {
			console.log("Not a git repo; scanning src/ directly.")
			const { readdirSync, statSync } = await import("fs")
			const { join } = await import("path")
			function walk(dir) {
				for (const name of readdirSync(dir)) {
					const p = join(dir, name)
					if (name === "node_modules" || name.startsWith(".")) continue
					if (statSync(p).isDirectory()) walk(p)
					else files.push(p)
				}
			}
			for (const d of ["src", "packages", "apps", "scripts"]) {
				try {
					walk(d)
				} catch {}
			}
		}
	} else if (isStaged) {
		try {
			const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
				encoding: "utf-8",
				stdio: "pipe",
			})
			files.push(...output.trim().split("\n").filter(Boolean))
		} catch {
			console.log("Not a git repo; scanning all tracked files.")
			const output = execSync("git ls-files", { encoding: "utf-8", stdio: "pipe" })
			files.push(...output.trim().split("\n").filter(Boolean))
		}
	} else {
		const stdin = createInterface({ input: process.stdin })
		for await (const line of stdin) {
			const file = line.trim()
			if (file) files.push(file)
		}
	}

	if (files.length === 0) {
		console.log("✅ No files to check.")
		process.exit(0)
	}

	let foundIssues = false

	for (const file of files) {
		// Skip binary files, lock files, and generated files
		if (
			file.endsWith(".lock") ||
			file.endsWith(".png") ||
			file.endsWith(".jpg") ||
			file.endsWith(".svg") ||
			file.endsWith(".vsix") ||
			file.match(/\.code-workspace$/)
		) {
			continue
		}

		// Skip large vendor corpora that contain documentation samples with
		// realistic-shaped credentials (logger_sample.md etc.). These are
		// individually allowlisted in ALLOWLISTED_FINDINGS as a backstop, but
		// the corpora are large enough that scanning them is wasted I/O.
		const normalizedFile = normalizePath(file)
		if (normalizedFile.includes("CangjieCorpus") || normalizedFile.includes("bundled-cangjie-corpus")) {
			continue
		}

		// NOTE: __tests__/ and *.spec/*.test files USED TO be skipped wholesale,
		// which let a real-format secret slip past CI as long as it lived in
		// any test file. The skip has been removed — every test file is now
		// scanned, and any legitimate fixture with a key-shaped string must
		// be listed in ALLOWLISTED_FINDINGS (per file + per pattern name).
		// Obvious-fake key shapes (sk-test-…, mock-token-…, etc.) are filtered
		// by isObviouslyFakeMatch() per finding, see below.

		let content
		try {
			content = readFileSync(file, "utf-8")
		} catch {
			continue // Binary or deleted file
		}

		// Honour `// gitleaks:allow` annotations: lines bearing that comment
		// are excluded from pattern matching. This is the standard gitleaks
		// convention and makes self-documenting fixtures possible.
		const scanned = stripGitleaksAllowLines(content)

		// Check each pattern
		for (const { pattern, name, fileName } of patterns) {
			// If the pattern has a fileName matcher, check the file name first
			if (fileName && !fileName.test(file)) continue
			if (pattern.test(scanned)) {
				if (isAllowlisted(file, name)) continue
				if (allMatchesAreObviouslyFake(scanned, pattern)) continue

				if (!foundIssues) {
					console.log(`\n⚠️  Potential secrets detected in ${scopeLabel}:\n`)
					foundIssues = true
				}
				console.log(`  📄 ${file} — may contain: ${name} (${pattern})`)
			}
		}
	}

	if (foundIssues) {
		console.log("\n❌ Commit blocked. Please remove secrets before committing.")
		console.log("   If these are false positives, use `git commit --no-verify` to bypass.\n")
		process.exit(1)
	}

	console.log(`✅ No secrets detected in ${scopeLabel}.`)
}

main().catch((err) => {
	console.error("Secret check failed:", err)
	process.exit(1)
})
