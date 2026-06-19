/**
 * decodeDiffBase64Query — defence-in-depth wrapper around `Buffer.from(q, "base64")`
 * for the diff virtual document content provider.
 *
 * Why this exists:
 *  - Diff URIs encode the original (left-hand) side as base64 in the URI query.
 *    A malicious or buggy producer could supply a multi-GB query that would
 *    otherwise be decoded synchronously on the extension host main thread,
 *    producing memory peaks and visible UI freezes.
 *  - VS Code does not enforce a query length cap, so we apply one here.
 *
 * Behaviour (strict):
 *  - Empty query → empty document, `ok: true`.
 *  - Query longer than `maxQueryChars` → user-visible error string, `ok: false`.
 *    Decoding is NOT attempted.
 *  - Query containing characters outside the strict base64 alphabet
 *    (`A–Za–z0–9+/`, optional trailing `=` padding) → user-visible error
 *    string, `ok: false`. Buffer.from is too forgiving for our security
 *    contract: it silently strips invalid bytes, which would let malformed
 *    payloads decode to plausible-looking content.
 *  - Decode-time exception → user-visible error string, `ok: false` (kept
 *    for defence in depth even though the strict alphabet check should have
 *    rejected such inputs already).
 */

/** 10MB plaintext ≈ ~13.4MB of base64 chars; round up to 14MB. */
export const MAX_DIFF_BASE64_QUERY_CHARS = 14 * 1024 * 1024

/**
 * Strict RFC 4648 base64 alphabet, with optional padding.
 * - Length, ignoring whitespace, must be a non-negative multiple of 4.
 * - Padding `=` may appear only at the end (0, 1, or 2 `=`).
 *
 * VS Code passes URI queries pre-decoded; we don't accept URL-safe `-_` here
 * because the producer side uses standard base64.
 */
const STRICT_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export interface DecodeDiffBase64Result {
	content: string
	/** True iff the query was decoded successfully. False on cap-hit / invalid base64. */
	ok: boolean
}

export function decodeDiffBase64Query(
	query: string | undefined | null,
	maxQueryChars: number = MAX_DIFF_BASE64_QUERY_CHARS,
): DecodeDiffBase64Result {
	const q = query ?? ""
	if (q.length === 0) {
		return { content: "", ok: true }
	}
	if (q.length > maxQueryChars) {
		return {
			content: `Diff content too large to display (${q.length} chars > ${maxQueryChars} cap).`,
			ok: false,
		}
	}

	// Strip incidental whitespace (some producers wrap base64 at column 76)
	// before validating against the strict alphabet.
	const stripped = q.replace(/\s+/g, "")
	if (stripped.length % 4 !== 0 || !STRICT_BASE64_RE.test(stripped)) {
		return {
			content: "Diff content could not be decoded (invalid base64).",
			ok: false,
		}
	}

	try {
		return { content: Buffer.from(stripped, "base64").toString("utf-8"), ok: true }
	} catch {
		return {
			content: "Diff content could not be decoded (invalid base64).",
			ok: false,
		}
	}
}
