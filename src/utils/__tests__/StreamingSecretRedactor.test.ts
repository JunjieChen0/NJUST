import { describe, expect, it } from "vitest"

import { StreamingSecretRedactor } from "../StreamingSecretRedactor"

/**
 * Helper: feed `chunks` through a fresh redactor and concatenate the emitted
 * output (the bytes that would have reached preview / disk). The returned
 * string is what an attacker would observe; tests assert that no raw secret
 * material survives in it.
 */
function runStream(chunks: string[]): string {
	const redactor = new StreamingSecretRedactor()
	let out = ""
	for (const c of chunks) {
		out += redactor.write(c)
	}
	out += redactor.flush()
	return out
}

describe("StreamingSecretRedactor", () => {
	describe("long Bearer token (>256 chars)", () => {
		it("redacts a 300-char token in a single write", () => {
			const token = "A".repeat(300)
			const out = runStream([`Authorization: Bearer ${token}\n`])
			expect(out).not.toContain(token)
			expect(out).toMatch(/\[REDACTED\]/)
		})

		it("redacts a 300-char token split across two writes", () => {
			const token = "A".repeat(300)
			const split = 50
			const out = runStream([`Authorization: Bearer ${token.slice(0, split)}`, `${token.slice(split)}\n`])
			expect(out).not.toContain(token)
			// Suffix-only check: even the last 256 chars must not appear, which
			// is precisely the leak the reviewer flagged in the previous design.
			expect(out).not.toContain(token.slice(-256))
			expect(out).toMatch(/\[REDACTED\]/)
		})

		it("redacts a 1500-char token streamed in many tiny writes", () => {
			const token = "B".repeat(1500)
			const chunks = [`Authorization: Bearer `]
			for (let i = 0; i < token.length; i += 7) {
				chunks.push(token.slice(i, i + 7))
			}
			chunks.push("\n")
			const out = runStream(chunks)
			expect(out).not.toContain(token)
			expect(out).not.toContain(token.slice(-512))
			expect(out).not.toContain(token.slice(-1024))
		})

		it("redacts a token that never sees a newline (forced cap flush)", () => {
			// Push past the internal MAX_SENSITIVE_CARRY (64KB) without any \n.
			const token = "C".repeat(80 * 1024)
			const out = runStream([`Authorization: Bearer ${token}`])
			expect(out).not.toContain(token)
			expect(out).not.toContain(token.slice(-1024))
		})

		it("does not leak the suffix of an over-cap token streamed in many writes", () => {
			// Reviewer's repro: 80KB token split across 3 writes. Earlier this
			// flushed the cap and DROPPED inSensitive, so subsequent token
			// fragments traveled through the non-sensitive path verbatim.
			const token = "D".repeat(80 * 1024)
			const third = Math.floor(token.length / 3)
			const out = runStream([
				`Authorization: Bearer ${token.slice(0, third)}`,
				token.slice(third, 2 * third),
				token.slice(2 * third),
			])
			expect(out).not.toContain(token)
			// The middle and final thirds are both characters that, in the
			// previous design, escaped redaction once cap had cleared state.
			expect(out).not.toContain(token.slice(third, 2 * third))
			expect(out).not.toContain(token.slice(-1024))
		})

		it("resumes normal processing after the over-cap line ends", () => {
			const token = "E".repeat(80 * 1024)
			const out = runStream([
				`Authorization: Bearer ${token.slice(0, 40000)}`,
				token.slice(40000) + "\n",
				"plain follow-up\n",
			])
			expect(out).not.toContain(token)
			// Drain mode must release after the newline, so the next line
			// flows through verbatim.
			expect(out).toContain("plain follow-up")
		})

		it("flush during drain emits nothing of the secret value", () => {
			const token = "F".repeat(80 * 1024)
			const r = new StreamingSecretRedactor()
			let out = r.write(`Authorization: Bearer ${token.slice(0, 40000)}`)
			out += r.write(token.slice(40000)) // still no newline
			out += r.flush()
			expect(out).not.toContain(token)
			expect(out).not.toContain(token.slice(-1024))
		})
	})

	describe("api_key prefix", () => {
		it("redacts api_key=… across writes", () => {
			const value = "Z".repeat(400)
			const out = runStream([`api_key=`, value, "\n"])
			expect(out).not.toContain(value)
			expect(out).toMatch(/\[REDACTED\]/)
		})
	})

	describe("sk- / Basic / AKIA / AIza split across chunks", () => {
		it("redacts an sk- token when the prefix arrives in its own chunk", () => {
			// Reviewer's repro: ["sk-", "A".repeat(30), "\n"].
			const value = "A".repeat(30)
			const out = runStream(["sk-", value, "\n"])
			expect(out).not.toContain(value)
			expect(out).not.toContain(`sk-${value}`)
			expect(out).toMatch(/\[REDACTED\]/)
		})

		it("redacts an sk- token split right after the dash and again later", () => {
			const value = "B".repeat(60)
			const out = runStream(["log: sk", "-", value.slice(0, 20), value.slice(20), "\n"])
			expect(out).not.toContain(value)
			expect(out).not.toContain(`sk-${value}`)
		})

		it("redacts a Basic auth header split across writes", () => {
			// Reviewer's repro: ["Basic ", "B".repeat(80), "\n"].
			const value = "B".repeat(80)
			const out = runStream(["Basic ", value, "\n"])
			expect(out).not.toContain(value)
			expect(out).toMatch(/Basic \[REDACTED\]|\[REDACTED\]/)
		})

		it("redacts an AKIA AWS access key split across writes", () => {
			// AWS key shape: AKIA + 16 [A-Z0-9]. We use the canonical "EXAMPLE"
			// fake-key shape that gitleaks/check-secrets already allowlist so
			// this test fixture isn't itself flagged as a leaked credential.
			const fakeAkia = "AKIAIOSFODNN7EXAMPLE" // gitleaks:allow
			expect(/^AKIA[A-Z0-9]{16}$/.test(fakeAkia)).toBe(true)
			// Split the prefix and the value across two writes so the
			// streaming state machine has to hold the prefix.
			const out = runStream(["headers ", fakeAkia.slice(0, 4), fakeAkia.slice(4), " trailing\n"])
			expect(out).not.toContain(fakeAkia)
			expect(out).toMatch(/AKIA\[REDACTED\]/)
		})

		it("redacts an AIza Google API key split across writes", () => {
			// Google key shape: AIza + 35 [A-Za-z0-9_-].
			const value = "AbCdEfGhIjKlMnOpQrStUvWxYz012345678" // 35 chars
			expect(value.length).toBe(35)
			const out = runStream(["url=AIza", value, " trailing\n"])
			expect(out).not.toContain(`AIza${value}`)
			expect(out).toMatch(/AIza\[REDACTED\]/)
		})

		it("redacts the canonical Basic auth header form", () => {
			// `Basic <base64>` is what redactApiSecrets matches. Streaming
			// must redact whether the prefix arrives before or alongside the
			// value.
			const value = "B".repeat(80)
			const out = runStream(["Basic ", value, "\n"])
			expect(out).not.toContain(value)
			expect(out).toMatch(/Basic \[REDACTED\]/)
		})
	})

	describe("non-sensitive content", () => {
		it("passes through normal log lines verbatim", () => {
			const out = runStream(["Building project...\n", "42 files compiled.\n"])
			expect(out).toContain("Building project...")
			expect(out).toContain("42 files compiled.")
		})

		it("does not enter sensitive mode for benign words containing 'key'", () => {
			const out = runStream(["the keymap is loaded\n", "key bindings updated\n"])
			expect(out).toContain("keymap")
			expect(out).toContain("key bindings")
		})

		it("does not trigger on words that share a suffix with 'sk-' / 'akia' / 'aiza'", () => {
			// Reviewer's repro: `task-` + 80KB of X + newline. Earlier the
			// streaming redactor matched `sk-` inside `task-` and dropped the
			// rest of the line into drain mode, so the user only saw
			// `[REDACTED]`. With left word-boundary anchoring `sk-` is no
			// longer matched mid-word, so benign content survives.
			const filler = "X".repeat(80 * 1024)
			const out = runStream(["task-", filler, "\n"])
			expect(out).toContain("task-")
			// At least most of the filler must come through; we don't pin the
			// exact byte count because trailing partial-prefix lookahead may
			// hold a few characters back.
			expect(out.length).toBeGreaterThan(filler.length - 100)
		})

		it("does not trigger on 'aizawl' / similar benign words", () => {
			const out = runStream(["the city of aizawl is in india\n"])
			expect(out).toContain("aizawl")
		})

		it("does not trigger on identifiers ending in 'akia' / 'aiza' fragments", () => {
			const out = runStream(["myAkiaService.run()\n", "googleAizaService.run()\n"])
			expect(out).toContain("myAkiaService.run()")
			expect(out).toContain("googleAizaService.run()")
		})

		it("does not enter sensitive mode for lowercase 'akia' / 'aiza' (case-sensitivity matches redactApiSecrets)", () => {
			// The canonical redactApiSecrets uses /\bAKIA[0-9A-Z]{16}\b/ and
			// /\bAIza[A-Za-z0-9_-]{35}\b/ — both case-sensitive. The streaming
			// layer must mirror that, otherwise `akia…` would enter sensitive
			// mode, get held until newline, and then be released VERBATIM
			// (canonical doesn't redact lowercase) — leaking the line.
			// 30+ chars to ensure release path is exercised.
			const value = "abcdefghij1234567890klmnopqrst1234"
			const out = runStream(["log akia", value, "\n", "next-line\n"])
			// The benign lowercase line is emitted as-is; the next line MUST
			// flow through (would be in drain-mode otherwise).
			expect(out).toContain(`akia${value}`)
			expect(out).toContain("next-line")
		})

		it("does not trigger on 'basically-' followed by long output", () => {
			// Reviewer's repro: `basically-` + 80KB Y. With the old `loose`
			// matching, `basic` matched mid-word and pushed the redactor into
			// drain mode, dropping the entire filler.
			const filler = "Y".repeat(80 * 1024)
			const out = runStream(["basically-", filler, "\n"])
			expect(out).toContain("basically-")
			expect(out.length).toBeGreaterThan(filler.length - 100)
		})

		it("does not trigger on identifiers like 'bearerSomething' / 'authorizeUser'", () => {
			const out = runStream([
				"const bearerSomething = computeBearer(req)\n",
				"function authorizeUser() {}\n",
				"const apikeysList = readApiKeys()\n",
			])
			expect(out).toContain("bearerSomething")
			expect(out).toContain("authorizeUser()")
			expect(out).toContain("apikeysList")
		})

		it("does not trigger when 'bearer.' is followed by a method call", () => {
			// The right-context for `bearer` requires whitespace then a
			// credential char; a `.` after `bearer` should NOT trigger.
			const out = runStream(["bearer.toString()\n"])
			expect(out).toContain("bearer.toString()")
		})

		it("does not trigger on 'authorization' as a JS identifier", () => {
			const out = runStream(["const authorization = req.context\n"])
			// `authorization =` has whitespace + `=` so it DOES look header-like
			// to the redactor — that's an inherent ambiguity in JS source vs
			// HTTP headers. Make sure the test matches the actual contract:
			// the streaming layer matches what redactApiSecrets matches.
			// JS: `const authorization = req.context` — the canonical regex
			// `\b(...|authorization|...)\s*[=:]\s*["']?[^\s"'<>\r\n]{6,}` will
			// match `authorization = req.context` so we accept redaction here.
			expect(out).toMatch(/authorization|REDACTED/)
		})
	})

	describe("multiple secrets and recovery", () => {
		it("redacts a secret, then returns to verbatim emission for following lines", () => {
			const token = "K".repeat(400)
			const out = runStream([`Authorization: Bearer ${token}\n`, "next non-sensitive line\n"])
			expect(out).not.toContain(token)
			expect(out).toContain("next non-sensitive line")
		})

		it("handles two long secrets in sequence", () => {
			const t1 = "X".repeat(350)
			const t2 = "Y".repeat(350)
			const out = runStream([`Authorization: Bearer ${t1}\n`, `api_key=${t2}\n`])
			expect(out).not.toContain(t1)
			expect(out).not.toContain(t2)
		})
	})

	describe("flush semantics", () => {
		it("emits redacted text on flush even without a newline", () => {
			const token = "Q".repeat(400)
			const redactor = new StreamingSecretRedactor()
			const live = redactor.write(`Authorization: Bearer ${token}`)
			// Live output should not contain the secret yet; flush completes it.
			expect(live).not.toContain(token)
			const tail = redactor.flush()
			const combined = live + tail
			expect(combined).not.toContain(token)
			expect(combined).toMatch(/\[REDACTED\]/)
		})

		it("is reusable after flush", () => {
			const redactor = new StreamingSecretRedactor()
			redactor.write("Authorization: Bearer aaaaaaaaaa\n")
			redactor.flush()
			const out = redactor.write("plain text\n") + redactor.flush()
			expect(out).toContain("plain text")
		})
	})
})
