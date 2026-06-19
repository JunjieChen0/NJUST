import { redactApiSecrets } from "./redactApiSecrets"

/**
 * StreamingSecretRedactor — token-aware, line-aware streaming redaction for
 * arbitrary chunked text streams (terminal output, log streams, etc.).
 *
 * Why this exists:
 *  - {@link redactApiSecrets} expects a complete buffer. When the buffer is
 *    streamed in chunks, a fixed-size tail carry (e.g. 256 chars) does NOT
 *    work for tokens whose value is longer than the carry: the secret prefix
 *    (`Authorization: Bearer …`) is in the early part and gets redacted
 *    correctly, but the remainder of the secret value (without the prefix)
 *    survives in the next release window because the sensitive prefix is no
 *    longer visible to the regex.
 *
 * Strategy (sensitive-prefix tracking):
 *  - We scan committed text for known "sensitive prefix" markers
 *    (`Authorization:`, `Bearer `, `api_key=`, …). When a marker is detected
 *    we enter "sensitive mode" and start buffering everything from the marker
 *    onward into a carry. We do NOT release any of it until a line boundary
 *    (`\n` / `\r`) or a hard size cap (`MAX_SENSITIVE_CARRY`) is reached.
 *  - When the boundary is reached we run the canonical {@link redactApiSecrets}
 *    on the entire carried region in one pass and emit the redacted result.
 *  - Outside sensitive mode we still run {@link redactApiSecrets} on every
 *    release so single-line secrets that fit in one chunk continue to be
 *    redacted as before. The bounded carry only affects the long-token path.
 *
 * Bounds:
 *  - `MAX_SENSITIVE_CARRY` caps how much we will buffer before forcibly
 *    redacting+emitting. This protects memory from a malicious peer that
 *    feeds an infinite secret without a newline.
 *
 * The redactor is stateful; create one per output stream and call
 * {@link write} for each chunk, then {@link flush} at end of stream.
 */

/**
 * Hard cap on how many chars we will buffer waiting for a line boundary.
 */
const MAX_SENSITIVE_CARRY = 64 * 1024

/**
 * Sensitive-prefix tokens. MUST stay in sync with the patterns in
 * {@link redactApiSecrets}. Whenever the canonical redactor learns about a
 * new family, add a token here so the streaming state machine traps it
 * across chunk boundaries the same way.
 *
 * Each entry contributes one alternative to {@link SENSITIVE_PREFIX_RE} and
 * is paired with a `right` matcher used by {@link endsWithPartialSensitivePrefix}.
 *
 * Boundary rules — chosen to mirror `redactApiSecrets` exactly so the
 * streaming layer is no more aggressive than the canonical redactor:
 *
 *   * `Bearer` / `Basic`           → must be followed by whitespace AND at
 *                                    least one credential character. Prevents
 *                                    `basically-…` and `Bearer.something()`
 *                                    from triggering.
 *   * `Authorization`              → header form: `Authorization` followed
 *                                    by optional whitespace then `:` or `=`.
 *                                    Prevents `authorizationContext` (an
 *                                    identifier) from triggering.
 *   * `api_key` / `api-key` /      → header / kv form: token followed by
 *     `apikey` / `x-api-key`         optional whitespace then `:` or `=`.
 *                                    Prevents `apikeysList`, `api_keys[i]`
 *                                    from triggering.
 *   * `sk-` / `akia` / `aiza`      → strict left word-boundary, no right
 *                                    constraint (the value follows directly
 *                                    in the same line). Prevents `task-`,
 *                                    `aizawl`, `myAkiaService` from
 *                                    triggering.
 *
 * `right` is intentionally permissive (it only needs to recognise that the
 * sensitive context HAS started, not the full secret). The canonical
 * {@link redactApiSecrets} runs over the held-back line later and decides
 * what is actually a credential value.
 */
type SensitiveTokenSpec = {
	/** The literal prefix, in canonical case (used for partial-prefix detection). */
	prefix: string
	/**
	 * Regex fragment (will be wrapped in `(?:…)` and joined with `|`) used to
	 * recognise the start of a sensitive context. Built so that:
	 *   * the LEFT side never matches mid-word (`(?:^|[^A-Za-z0-9])` or `\b`)
	 *   * the RIGHT side requires the canonical context (whitespace value /
	 *     header colon / etc.)
	 *
	 * The fragment is responsible for spelling out its own case-sensitivity
	 * (the joined RegExp does NOT use the `/i` flag) so AKIA / AIza / sk-
	 * stay strictly case-sensitive while loose tokens use {@link ciLiteral}.
	 */
	regex: string
	/**
	 * True if the literal `prefix` should be matched case-insensitively in
	 * {@link endsWithPartialSensitivePrefix}. Mirrors the case behaviour of
	 * the corresponding entry in {@link redactApiSecrets} so the streaming
	 * layer holds back the same chunks the canonical redactor would actually
	 * redact — and DOESN'T hold back chunks that the canonical redactor will
	 * leave alone (which would leak them into the next line).
	 */
	caseInsensitive: boolean
	/**
	 * Predicate used by {@link endsWithPartialSensitivePrefix} once the
	 * literal prefix is at the right edge of the carry. Returning true means
	 * "the next chunk MAY supply the right-context, so hold the carry".
	 *
	 * Implemented as a function rather than another regex because the
	 * partial-prefix check has different inputs (carry slice, position).
	 */
	rightCouldFollow: (carry: string, idx: number) => boolean
}

/**
 * Build a regex fragment that matches `s` case-insensitively without relying
 * on the `/i` flag. Used so we can keep `AKIA` / `AIza` strictly upper-case
 * (matching the canonical {@link redactApiSecrets} regexes) while the loose
 * tokens like `Bearer` / `Authorization` remain case-insensitive.
 */
function ciLiteral(s: string): string {
	return Array.from(s)
		.map((ch) => {
			const code = ch.charCodeAt(0)
			if (code >= 65 && code <= 90) return `[${ch}${ch.toLowerCase()}]`
			if (code >= 97 && code <= 122) return `[${ch.toUpperCase()}${ch}]`
			return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		})
		.join("")
}

const NON_WORD_LEFT = "(?:^|[^A-Za-z0-9])"

/** True if `idx` is at the start of `s` or the preceding char is non-word. */
function hasNonWordLeftBoundary(s: string, idx: number): boolean {
	if (idx <= 0) return true
	const prev = s.charCodeAt(idx - 1)
	const isWord =
		(prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122) || prev === 95 /* '_' */
	return !isWord
}

/**
 * Used for tokens that are followed by a value separated by whitespace
 * (Bearer, Basic). Returns true if the carry tail past `idx` is empty (could
 * be a future write) or starts with a whitespace.
 */
function rightIsOrCouldBeWhitespace(carry: string, idx: number): boolean {
	if (idx >= carry.length) return true
	return /\s/.test(carry[idx]!)
}

/**
 * Used for header-style tokens (Authorization / api_key / etc.) that are
 * followed by `:` or `=` with optional whitespace. Returns true if the
 * remaining tail is empty, only whitespace, or whitespace followed by `:`/`=`.
 */
function rightIsOrCouldBeHeaderSeparator(carry: string, idx: number): boolean {
	if (idx >= carry.length) return true
	const tail = carry.slice(idx)
	return /^\s*$/.test(tail) || /^\s*[:=]/.test(tail)
}

const SENSITIVE_TOKENS: readonly SensitiveTokenSpec[] = [
	{
		prefix: "bearer",
		regex: `${NON_WORD_LEFT}${ciLiteral("bearer")}\\s+\\S`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeWhitespace,
	},
	{
		prefix: "basic",
		regex: `${NON_WORD_LEFT}${ciLiteral("basic")}\\s+\\S`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeWhitespace,
	},
	{
		prefix: "authorization",
		regex: `${NON_WORD_LEFT}${ciLiteral("authorization")}\\s*[:=]`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeHeaderSeparator,
	},
	{
		prefix: "api_key",
		regex: `${NON_WORD_LEFT}${ciLiteral("api_key")}\\s*[:=]`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeHeaderSeparator,
	},
	{
		prefix: "api-key",
		regex: `${NON_WORD_LEFT}${ciLiteral("api-key")}\\s*[:=]`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeHeaderSeparator,
	},
	{
		prefix: "apikey",
		regex: `${NON_WORD_LEFT}${ciLiteral("apikey")}\\s*[:=]`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeHeaderSeparator,
	},
	{
		prefix: "x-api-key",
		regex: `${NON_WORD_LEFT}${ciLiteral("x-api-key")}\\s*[:=]`,
		caseInsensitive: true,
		rightCouldFollow: rightIsOrCouldBeHeaderSeparator,
	},
	{
		// `sk-` is matched case-sensitively because the canonical redactor
		// (`/\bsk-[A-Za-z0-9_-]{20,}\b/g`) is also case-sensitive.
		prefix: "sk-",
		regex: `${NON_WORD_LEFT}sk-`,
		caseInsensitive: false,
		rightCouldFollow: () => true,
	},
	{
		// AWS access keys: `\bAKIA[0-9A-Z]{16}\b` — case-sensitive.
		prefix: "AKIA",
		regex: `${NON_WORD_LEFT}AKIA`,
		caseInsensitive: false,
		rightCouldFollow: () => true,
	},
	{
		// Google API keys: `\bAIza[A-Za-z0-9_-]{35}\b` — case-sensitive prefix.
		prefix: "AIza",
		regex: `${NON_WORD_LEFT}AIza`,
		caseInsensitive: false,
		rightCouldFollow: () => true,
	},
]

/**
 * Sensitive-prefix detection regex. Built from {@link SENSITIVE_TOKENS} so
 * the marker list has a single source of truth. Note: NO `/i` flag — each
 * loose token spells out its own case-insensitive form via {@link ciLiteral}
 * so AKIA / AIza / sk- can stay case-sensitive (matching `redactApiSecrets`).
 */
const SENSITIVE_PREFIX_RE = new RegExp(SENSITIVE_TOKENS.map((t) => `(?:${t.regex})`).join("|"))

/** Returns the index of the first `\n` or `\r` in `s`, or -1. */
function firstLineBreak(s: string): number {
	const lf = s.indexOf("\n")
	const cr = s.indexOf("\r")
	if (lf < 0) return cr
	if (cr < 0) return lf
	return Math.min(lf, cr)
}

/**
 * Tail length we hold back when the carry's suffix MIGHT be the start of a
 * sensitive prefix (e.g. ends with "Authoriz" — could become "Authorization").
 * Only kicks in when the suffix actually looks like a partial prefix; benign
 * output flows through with zero latency.
 */
const PARTIAL_PREFIX_LOOKAHEAD = 32

/**
 * Heuristic: does `tail` end with a fragment that could grow into a sensitive
 * prefix in a subsequent write? Used to decide whether a non-sensitive carry
 * is needed at all.
 *
 * Two checks per token (lower-cased), each requiring left + right boundary:
 *   * Whole token sits at the very end (e.g. `… sk-`). Left boundary is the
 *     same word-boundary check used by {@link SENSITIVE_PREFIX_RE}; right
 *     boundary is `tokenSpec.rightCouldFollow` which is `true` when the next
 *     write COULD supply the canonical right-context.
 *   * Suffix-of-tail is a (non-empty, < token-length) prefix-of-token. We
 *     hold so the next write can complete the token.
 *
 * Without right-boundary checks we would hold benign tails like `bearer.`
 * (followed by a method call) until the next write, which is harmless for
 * latency but accumulates over very long log streams; with the check we
 * release straight away.
 */
function endsWithPartialSensitivePrefix(tail: string): boolean {
	const rawSlice = tail.slice(-PARTIAL_PREFIX_LOOKAHEAD)
	const lowerSlice = rawSlice.toLowerCase()
	for (const spec of SENSITIVE_TOKENS) {
		// Use the lower-cased buffer for case-insensitive tokens; raw for
		// strictly cased ones (sk- / AKIA / AIza). The token literal is in
		// its canonical case in the spec, so for case-sensitive comparison
		// we just compare against the raw slice directly.
		const slice = spec.caseInsensitive ? lowerSlice : rawSlice
		const tokenLiteral = spec.caseInsensitive ? spec.prefix.toLowerCase() : spec.prefix

		// Case 1: whole token sits at the end of the carry.
		if (slice.endsWith(tokenLiteral)) {
			const tokenStart = slice.length - tokenLiteral.length
			const tokenEnd = slice.length
			if (hasNonWordLeftBoundary(slice, tokenStart) && spec.rightCouldFollow(slice, tokenEnd)) {
				return true
			}
		}

		// Case 1b: the literal token sits earlier in the slice and the
		// remainder is *consistent with* the start of its right-context
		// (e.g. carry is `"Basic "` — `basic` is at idx 0, the trailing
		// space is the start of the required `\s+\S` so the next write
		// might supply the value). Without this we'd release the carry
		// before the value arrives, and the next chunk no longer carries
		// the prefix.
		const earlier = slice.lastIndexOf(tokenLiteral)
		if (earlier >= 0 && earlier !== slice.length - tokenLiteral.length) {
			const after = earlier + tokenLiteral.length
			if (hasNonWordLeftBoundary(slice, earlier) && spec.rightCouldFollow(slice, after)) {
				return true
			}
		}

		// Case 2: a non-empty proper-prefix of the token sits at the end.
		// We don't yet know the right side, so only enforce the left-boundary
		// check; the right side will be re-evaluated on the next write.
		const maxOverlap = Math.min(slice.length, tokenLiteral.length - 1)
		for (let n = 1; n <= maxOverlap; n++) {
			if (tokenLiteral.startsWith(slice.slice(slice.length - n))) {
				if (hasNonWordLeftBoundary(slice, slice.length - n)) {
					return true
				}
				break
			}
		}
	}
	return false
}

export class StreamingSecretRedactor {
	/** Text that is being held back, either because we are in sensitive mode
	 *  or because the tail might be a partial sensitive prefix. */
	private carry = ""
	/** True once a sensitive-prefix marker has been seen and not yet flushed. */
	private inSensitive = false
	/**
	 * "Drain" mode: a sensitive line exceeded {@link MAX_SENSITIVE_CARRY}
	 * without a line boundary. From this point until we see `\n` / `\r` (or
	 * {@link flush} is called) we DROP all input — the sensitive prefix that
	 * was buffered into `carry` is already redacted and emitted as
	 * `[REDACTED]`, so any further bytes belonging to the SAME line are part
	 * of the secret value and must not leak through the non-sensitive code
	 * path on subsequent writes. This guards against an attacker that streams
	 * an unbounded secret without a newline.
	 */
	private draining = false

	/**
	 * Feed a chunk of input. Returns the (already-redacted) text that is safe
	 * to emit downstream right now. Some text may be retained internally and
	 * released by a subsequent {@link write} or {@link flush}.
	 */
	write(chunk: string): string {
		if (!chunk) return ""

		// Drain mode: silently consume bytes that belong to the same overflowed
		// sensitive line, until we see a newline. Whatever appears AFTER the
		// newline is treated as a fresh stream.
		if (this.draining) {
			const nlIdx = firstLineBreak(chunk)
			if (nlIdx < 0) {
				return "" // still inside the overflowed line, nothing to emit
			}
			// Resume processing on the post-newline tail. Emit only the newline
			// itself so downstream tooling (UI / artifact) sees that the line
			// ended, then process the rest as a normal new chunk.
			this.draining = false
			const newline = chunk[nlIdx] ?? "\n"
			const tail = chunk.slice(nlIdx + 1)
			return newline + (tail ? this.write(tail) : "")
		}

		this.carry += chunk

		// Enter sensitive mode lazily if we now see a marker anywhere in the carry.
		if (!this.inSensitive && SENSITIVE_PREFIX_RE.test(this.carry)) {
			this.inSensitive = true
		}

		if (this.inSensitive) {
			return this.releaseSensitive()
		}
		return this.releaseNonSensitive()
	}

	/**
	 * End-of-stream: redact and emit anything still buffered. After flush the
	 * redactor is reset so it can be reused.
	 */
	flush(): string {
		const tail = this.carry
		this.carry = ""
		this.inSensitive = false
		const wasDraining = this.draining
		this.draining = false
		// If we ended while draining a too-long sensitive line, we have already
		// emitted `[REDACTED]` for the prefix; the unflushed tail (if any) is
		// part of the same secret and must NOT be emitted.
		if (wasDraining) return ""
		if (!tail) return ""
		return redactApiSecrets(tail)
	}

	/**
	 * Release everything up to and including the latest line boundary, after
	 * running the canonical redactor on it. Anything after the last boundary
	 * stays in the carry. If the carry exceeds {@link MAX_SENSITIVE_CARRY}
	 * without a boundary we emit a single `[REDACTED]\n` placeholder for the
	 * overflowed line and switch to {@link draining} mode so the rest of the
	 * line is dropped on subsequent writes.
	 */
	private releaseSensitive(): string {
		// Find last newline — we release whole lines so the secret prefix is
		// always visible to redactApiSecrets in the same scan.
		const lastNl = Math.max(this.carry.lastIndexOf("\n"), this.carry.lastIndexOf("\r"))
		if (lastNl >= 0) {
			const release = this.carry.slice(0, lastNl + 1)
			const remaining = this.carry.slice(lastNl + 1)
			this.carry = remaining
			// If the remaining tail no longer contains a sensitive prefix, we
			// can drop sensitive mode — the next chunk decides anew.
			if (remaining.length === 0 || !SENSITIVE_PREFIX_RE.test(remaining)) {
				this.inSensitive = false
			}
			return redactApiSecrets(release)
		}

		// No newline yet. If we're below the cap, hold everything.
		if (this.carry.length < MAX_SENSITIVE_CARRY) {
			return ""
		}

		// Hard cap: the line is too long to hold. Emit a single placeholder
		// for the prefix region and switch to drain mode — every subsequent
		// byte until a newline (or flush) is dropped, including bytes that
		// would otherwise look benign in isolation.
		this.carry = ""
		this.inSensitive = false
		this.draining = true
		return "[REDACTED]"
	}

	/**
	 * No sensitive prefix has been seen yet. Emit the carry immediately
	 * UNLESS the trailing characters look like the start of a sensitive
	 * prefix that might complete in the next write (e.g. carry ends with
	 * "Authoriz"). In that case we hold a tiny lookahead window back so the
	 * full prefix is detectable on the next write.
	 *
	 * This keeps benign streams (`getBufferForUI()` snapshots, normal logs)
	 * latency-free, and only adds a few-character delay when the suffix is
	 * suspicious.
	 */
	private releaseNonSensitive(): string {
		if (!endsWithPartialSensitivePrefix(this.carry)) {
			const release = this.carry
			this.carry = ""
			// Run the canonical redactor for completeness — covers single-write
			// short secrets where the prefix and value land in the same chunk.
			return redactApiSecrets(release)
		}

		// Hold the suspicious tail back; emit the rest.
		const holdLen = Math.min(this.carry.length, PARTIAL_PREFIX_LOOKAHEAD)
		const releaseLen = this.carry.length - holdLen
		if (releaseLen <= 0) {
			return ""
		}
		const release = this.carry.slice(0, releaseLen)
		this.carry = this.carry.slice(releaseLen)
		return redactApiSecrets(release)
	}
}
