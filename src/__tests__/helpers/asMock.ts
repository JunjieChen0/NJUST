/**
 * Test-only cast for partial mocks of classes/interfaces whose private members
 * cannot be satisfied structurally. Production code must not use this helper.
 */
export function asMock<T>(value: unknown): T {
	return value as unknown as T
}
