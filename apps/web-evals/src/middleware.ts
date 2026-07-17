import { NextResponse, type NextRequest } from "next/server"
import { validateBasicAuthHeader } from "@/lib/server/admin-auth"

export function middleware(request: NextRequest) {
	// ── Layer 1: HTTP Basic Authentication ──────────────────────────────────
	// Check credentials before anything else. The middleware matcher excludes
	// /api routes (they have their own guards) and static assets.
	const authHeader = request.headers.get("authorization")
	if (!validateBasicAuthHeader(authHeader)) {
		return new NextResponse("Unauthorized", {
			status: 401,
			headers: {
				"WWW-Authenticate": 'Basic realm="Evals Admin", charset="UTF-8"',
			},
		})
	}

	// ── CSP Headers ─────────────────────────────────────────────────────────
	const nonce = generateNonce()

	const response = NextResponse.next({
		request: {
			headers: new Headers(request.headers),
		},
	})

	response.headers.set("x-nonce", nonce)

	const isProduction = process.env.NODE_ENV === "production"
	const reportUri = isProduction ? "" : ""

	const cspDirectives = [
		`default-src 'self'`,
		`script-src 'self' 'nonce-${nonce}'`,
		`style-src 'self' 'unsafe-inline'`,
		`img-src 'self' data: blob:`,
		`font-src 'self' data:`,
		`connect-src 'self'`,
		`frame-ancestors 'none'`,
		`base-uri 'self'`,
		`form-action 'self'`,
	]

	if (reportUri) {
		cspDirectives.push(`report-uri ${reportUri}`)
	}

	response.headers.set("Content-Security-Policy", cspDirectives.join("; "))

	return response
}

function generateNonce(): string {
	// Edge-compatible: use Web Crypto API instead of node:crypto
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	return btoa(String.fromCharCode(...bytes)).slice(0, 32)
}

export const config = {
	matcher: [
		/*
		 * Match all page routes except:
		 * - api routes (have their own guards)
		 * - _next/static (static files)
		 * - _next/image (image optimization)
		 * - favicon.ico
		 */
		"/((?!api|_next/static|_next/image|favicon.ico).*)",
	],
}
