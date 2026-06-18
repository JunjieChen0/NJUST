/**
 * Type augmentations for TUI runtime types and OpenTUI renderer.
 *
 *  - IpcMessage: request payload fields (method/id/params)
 *  - CliRenderer: dispose() method
 */

declare module "../runtime/ipc-protocol.ts" {
	interface IpcRequest {
		method: string
		id: string
		params?: unknown
	}
	interface IpcMessage {
		// helper union: when type === "request", the message has method/id/params
		method?: string
		id?: string
		params?: unknown
	}
}

declare module "@opentui/core" {
	interface CliRenderer {
		dispose(): void
	}
}

export {}
