/**
 * Sensitive-file guard for Cloud Agent deferred tool calls.
 *
 * The deferred protocol lets a REMOTE server choose which local files the
 * client reads and sends back via `resume`. Local `read_file` is auto-approved
 * by design, but a server-selected read has a different trust boundary: a
 * compromised or malicious Cloud Agent could otherwise exfiltrate `.env`,
 * private keys, or credential files from inside the workspace.
 *
 * This denylist is a hard stop — it is applied even when the user has opted
 * out of per-call approval — so a single mis-click cannot leak these files.
 * It intentionally matches relative / basename shapes (paths are confined to
 * the workspace by `ensureWithinWorkspace`), not just absolute shell paths.
 */

const SENSITIVE_FILE_RULES: Array<{ pattern: RegExp; reason: string }> = [
	// `.env`, `.env.local`, `.env.production` … but NOT the commonly committed
	// templates `.env.example` / `.env.sample` / `.env.template`, which contain
	// placeholders rather than secrets.
	{
		pattern: /(^|\/)\.env(\.(?!example|sample|template|dist|default)[^/]*)?$/i,
		reason: "dotenv file (.env)",
	},
	{ pattern: /(^|\/)\.npmrc$/i, reason: "npm config (may contain auth tokens)" },
	{ pattern: /(^|\/)\.pypirc$/i, reason: "PyPI credentials" },
	{ pattern: /(^|\/)\.netrc$/i, reason: "netrc credentials" },
	{ pattern: /(^|\/)\.git-credentials$/i, reason: "git credentials" },
	{ pattern: /(^|\/)\.htpasswd$/i, reason: "htpasswd file" },
	{ pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i, reason: "SSH private key" },
	{ pattern: /(^|\/)[^/]+\.(pem|p12|pfx|key|keystore|jks)$/i, reason: "private key / certificate file" },
	{ pattern: /(^|\/)\.ssh(\/|$)/i, reason: "SSH directory" },
	{ pattern: /(^|\/)\.aws(\/|$)/i, reason: "AWS credentials directory" },
	{ pattern: /(^|\/)\.gnupg(\/|$)/i, reason: "GnuPG directory" },
	{ pattern: /(^|\/)\.kube\/config$/i, reason: "Kubernetes config" },
	{ pattern: /(^|\/)\.docker\/config\.json$/i, reason: "Docker credentials" },
	{ pattern: /(^|\/)(credentials|secrets?)(\.json|\.ya?ml|\.toml)$/i, reason: "credential/secret file" },
]

/** Normalize a caller-supplied path so Windows separators and `./` are handled. */
function normalizePath(input: string): string {
	return input.replace(/\\/g, "/").replace(/^\.\//, "")
}

/**
 * Returns a human-readable reason when `path` looks like a secret/credential
 * file, or `undefined` when the path is safe to read.
 */
export function findSensitivePathReason(input: string): string | undefined {
	if (!input) return undefined
	const normalized = normalizePath(input)
	for (const { pattern, reason } of SENSITIVE_FILE_RULES) {
		if (pattern.test(normalized)) {
			return reason
		}
	}
	return undefined
}
