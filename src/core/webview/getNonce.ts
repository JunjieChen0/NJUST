import * as crypto from "crypto"

/**
 * Returns a cryptographically secure nonce for Content Security Policy.
 * Uses crypto.randomUUID() instead of Math.random() to prevent nonce prediction.
 *
 * @returns A CSP-safe nonce
 */
export function getNonce(): string {
	return crypto.randomUUID()
}
