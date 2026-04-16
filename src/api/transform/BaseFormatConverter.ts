/**
 * Shared helpers for message/tool format conversion (report D — dedupe).
 * Subclass per-provider converters as logic is consolidated.
 */
export abstract class BaseFormatConverter {
	protected safeJsonStringify(value: unknown): string {
		try {
			return JSON.stringify(value)
		} catch {
			return String(value)
		}
	}
}
