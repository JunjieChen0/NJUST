import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

const MIN_SECRET_LENGTH = 32
const MAX_SECRET_LENGTH = 256
const FORBIDDEN_SECRETS = new Set([
	"",
	"changeme",
	"secret",
	"password",
	"admin",
	"test",
	"dev",
	"example",
	"your-secret-here",
	"replace-me",
])

/** Stable admin actor identifier for audit logs (never a secret/token). */
const ADMIN_ACTOR = "admin:evals"

class AuthError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message)
		this.name = "AuthError"
	}
}

function getAdminSecret(): string {
	const secret = process.env.EVALS_ADMIN_SECRET

	if (!secret || secret.trim() === "") {
		throw new AuthError("Security configuration missing", 503)
	}

	if (FORBIDDEN_SECRETS.has(secret.toLowerCase())) {
		throw new AuthError("Security configuration invalid", 503)
	}

	if (secret.length < MIN_SECRET_LENGTH) {
		throw new AuthError("Security configuration invalid", 503)
	}

	if (secret.length > MAX_SECRET_LENGTH) {
		throw new AuthError("Security configuration invalid", 503)
	}

	return secret
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Edge-runtime compatible (no node:crypto dependency).
 */
function constantTimeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false
	}
	let result = 0
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i)
	}
	return result === 0
}

/**
 * Extract credential from request headers.
 * Supports only `Authorization: Basic <base64>` (password portion).
 * Cookie-based auth has been removed — Basic auth credentials are
 * automatically sent by the browser on subsequent requests after
 * the initial 401 + WWW-Authenticate challenge.
 */
function extractCredentialFromHeaders(headerList: Headers): string | null {
	const authHeader = headerList.get("authorization")
	if (authHeader && authHeader.startsWith("Basic ")) {
		try {
			const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
			const colonIndex = decoded.indexOf(":")
			if (colonIndex > 0) {
				const password = decoded.slice(colonIndex + 1)
				if (password.length > 0 && password.length <= MAX_SECRET_LENGTH) {
					return password
				}
			}
		} catch {
			// Invalid base64 encoding, ignore
		}
	}

	return null
}

function validateCredential(credential: string | null, secret: string): boolean {
	if (!credential) {
		return false
	}
	return constantTimeCompare(credential, secret)
}

/**
 * Guard for Server Actions ("use server" functions).
 * Reads credentials from `next/headers()` and throws AuthError on failure.
 */
export async function requireAdminForAction(): Promise<void> {
	const secret = getAdminSecret()
	const headerList = await headers()

	const credential = extractCredentialFromHeaders(headerList)

	if (!validateCredential(credential, secret)) {
		throw new AuthError("Unauthorized", 401)
	}
}

/**
 * Guard for SSR page components (Server Components).
 * Same mechanism as requireAdminForAction — uses next/headers().
 * Place this call BEFORE any database queries in page components.
 */
export async function requireAdminForPage(): Promise<void> {
	const secret = getAdminSecret()
	const headerList = await headers()

	const credential = extractCredentialFromHeaders(headerList)

	if (!validateCredential(credential, secret)) {
		throw new AuthError("Unauthorized", 401)
	}
}

/**
 * Guard for API Route handlers.
 * Receives the raw NextRequest and returns a NextResponse on failure (or null on success).
 */
export async function requireAdminForRequest(
	request: NextRequest,
): Promise<NextResponse | null> {
	let secret: string
	try {
		secret = getAdminSecret()
	} catch (e) {
		const statusCode = e instanceof AuthError ? e.statusCode : 503
		return createErrorResponse("Security configuration error", statusCode)
	}

	const credential = extractCredentialFromHeaders(request.headers)

	if (!validateCredential(credential, secret)) {
		return createErrorResponse("Unauthorized", 401)
	}

	return null
}

/**
 * Validate credentials from a raw Authorization header string.
 * Used by middleware (which has access to the raw request, not next/headers).
 */
export function validateBasicAuthHeader(authorizationHeader: string | null): boolean {
	let secret: string
	try {
		secret = getAdminSecret()
	} catch {
		return false
	}

	const credential = extractBasicPassword(authorizationHeader)
	return validateCredential(credential, secret)
}

function extractBasicPassword(authHeader: string | null): string | null {
	if (!authHeader || !authHeader.startsWith("Basic ")) {
		return null
	}
	try {
		const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
		const colonIndex = decoded.indexOf(":")
		if (colonIndex > 0) {
			const password = decoded.slice(colonIndex + 1)
			if (password.length > 0 && password.length <= MAX_SECRET_LENGTH) {
				return password
			}
		}
	} catch {
		// Invalid base64
	}
	return null
}

function createErrorResponse(message: string, status: number): NextResponse {
	return NextResponse.json({ error: message }, { status })
}

export function isAuthError(e: unknown): e is AuthError {
	return e instanceof AuthError
}

export { ADMIN_ACTOR, MIN_SECRET_LENGTH, MAX_SECRET_LENGTH, FORBIDDEN_SECRETS }
