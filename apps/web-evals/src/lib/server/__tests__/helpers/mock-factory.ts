import type { NextRequest, NextResponse } from "next/server"

export interface Mocks {
	headers: Headers
	cookies: { get: (name: string) => { value?: string } | undefined }
}

export function createMocks(): Mocks {
	return {
		headers: new Headers(),
		cookies: { get: () => undefined },
	}
}

export function createMockCookies(values: Record<string, string> = {}) {
	return {
		get: (name: string) => {
			const value = values[name]
			if (value === undefined) return undefined
			return { value }
		},
	}
}

export function createMockRequest(
	method: string,
	url: string,
	headers: Record<string, string> = {},
	cookieValues: Record<string, string> = {},
): NextRequest {
	const headerList = new Headers(headers)
	const cookieStore = createMockCookies(cookieValues)

	const request = {
		method,
		url,
		headers: headerList,
		cookies: cookieStore,
		signal: new AbortController().signal,
	} as unknown as NextRequest

	return request
}

export function createMockNextResponse(): {
	json: (body: unknown, init?: { status?: number }) => NextResponse
} {
	return {
		json: (body: unknown, init?: { status?: number }) => {
			return { status: init?.status ?? 200, body } as unknown as NextResponse
		},
	}
}
