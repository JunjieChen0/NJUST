/**
 * Bun IPC Protocol
 *
 * Defines the communication protocol between the Node.js main process
 * (ExtensionHost/Agent) and the Bun TUI subprocess (OpenTUI/SolidJS).
 *
 * Protocol: stdio + NDJSON (newline-delimited JSON)
 *
 * Message Flow:
 * ```
 * Node Main Process (ExtensionHost)
 *     ↕ IPC (stdin/stdout NDJSON)
 * Bun TUI Subprocess (OpenTUI)
 * ```
 */

// =============================================================================
// Message Types
// =============================================================================

export type IpcMessage = IpcRequest | IpcResponse | IpcEvent

export interface IpcRequest {
	type: "request"
	id: string
	method: IpcMethod
	params?: unknown
}

export interface IpcResponse {
	type: "response"
	id: string
	result?: unknown
	error?: IpcError
}

export interface IpcEvent {
	type: "event"
	event: IpcEventType
	data: unknown
}

export interface IpcError {
	code: string
	message: string
}

// =============================================================================
// Methods (Node → Bun)
// =============================================================================

export type IpcMethod =
	| "init"
	| "startTask"
	| "resumeTask"
	| "sendMessage"
	| "approve"
	| "reject"
	| "answer"
	| "cancel"
	| "dispose"

// =============================================================================
// Events (Bun → Node)
// =============================================================================

export type IpcEventType =
	| "ready"
	| "exit"
	| "error"
	| "message" // TuiRuntimeEvent forwarded
	| "log"

// =============================================================================
// IPC Protocol Handler
// =============================================================================

export class IpcProtocol {
	private static SEPARATOR = "\n"

	/**
	 * Serialize a message to NDJSON string.
	 */
	static serialize(message: IpcMessage): string {
		return JSON.stringify(message) + IpcProtocol.SEPARATOR
	}

	/**
	 * Parse NDJSON lines into messages.
	 */
	static parse(data: string): IpcMessage[] {
		const lines = data.split(IpcProtocol.SEPARATOR)
		const messages: IpcMessage[] = []

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue
			try {
				messages.push(JSON.parse(trimmed) as IpcMessage)
			} catch {
				// Skip invalid JSON
			}
		}

		return messages
	}

	/**
	 * Create a request message.
	 */
	static createRequest(method: IpcMethod, params?: unknown): IpcRequest {
		return {
			type: "request",
			id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
			method,
			params,
		}
	}

	/**
	 * Create a response message.
	 */
	static createResponse(id: string, result?: unknown, error?: IpcError): IpcResponse {
		return {
			type: "response",
			id,
			result,
			error,
		}
	}

	/**
	 * Create an event message.
	 */
	static createEvent(event: IpcEventType, data: unknown): IpcEvent {
		return {
			type: "event",
			event,
			data,
		}
	}
}

// =============================================================================
// IPC Client (Node side - connects to Bun subprocess)
// =============================================================================

import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"
import path from "path"
import fs from "fs"

export interface IpcClientOptions {
	bunPath?: string
	tuiScriptPath: string
	workspacePath: string
	env?: Record<string, string>
}

export class IpcClient extends EventEmitter {
	private process: ChildProcess | null = null
	private buffer = ""
	private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
	private isReady = false

	constructor(private options: IpcClientOptions) {
		super()
	}

	async start(): Promise<void> {
		const bunPath = this.options.bunPath || this.findBunBinary()
		if (!bunPath) {
			throw new Error("Bun runtime not found. Install Bun: curl -fsSL https://bun.sh/install | bash")
		}

		const scriptPath = this.options.tuiScriptPath
		if (!fs.existsSync(scriptPath)) {
			throw new Error(`TUI script not found: ${scriptPath}`)
		}

		this.process = spawn(bunPath, [scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				...this.options.env,
				NJUST_AI_WORKSPACE: this.options.workspacePath,
			},
			cwd: this.options.workspacePath,
		})

		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleStdout(data)
		})

		this.process.stderr?.on("data", (data: Buffer) => {
			const text = data.toString()
			this.emit("log", text)
		})

		this.process.on("exit", (code, signal) => {
			this.emit("exit", { code, signal })
			this.rejectAllPending("Bun process exited")
		})

		this.process.on("error", (err) => {
			this.emit("error", err)
			this.rejectAllPending(err.message)
		})

		// Wait for ready event
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Timeout waiting for TUI ready event"))
			}, 10000)

			this.once("ready", () => {
				clearTimeout(timeout)
				this.isReady = true
				resolve()
			})

			this.once("error", (err) => {
				clearTimeout(timeout)
				reject(err)
			})
		})
	}

	private handleStdout(data: Buffer): void {
		this.buffer += data.toString()

		// Process complete lines
		const lines = this.buffer.split("\n")
		this.buffer = lines.pop() || ""

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue

			try {
				const message = JSON.parse(trimmed) as IpcMessage

				if (message.type === "event") {
					if (message.event === "ready") {
						this.emit("ready")
					} else if (message.event === "exit") {
						this.emit("exit", message.data)
					} else if (message.event === "error") {
						this.emit("error", new Error((message.data as IpcError)?.message || "Unknown error"))
					} else if (message.event === "log") {
						this.emit("log", message.data)
					} else {
						// Forward as TuiRuntimeEvent
						this.emit("message", message.data)
					}
				} else if (message.type === "response") {
					const pending = this.pendingRequests.get(message.id)
					if (pending) {
						this.pendingRequests.delete(message.id)
						if (message.error) {
							pending.reject(new Error(message.error.message))
						} else {
							pending.resolve(message.result)
						}
					}
				}
			} catch {
				// Skip invalid JSON
			}
		}
	}

	async send(method: IpcMethod, params?: unknown): Promise<unknown> {
		if (!this.process || !this.isReady) {
			throw new Error("IPC client not ready")
		}

		const request = IpcProtocol.createRequest(method, params)

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(request.id, { resolve, reject })

			const data = IpcProtocol.serialize(request)
			this.process?.stdin?.write(data)

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(request.id)) {
					this.pendingRequests.delete(request.id)
					reject(new Error(`IPC request timeout: ${method}`))
				}
			}, 30000)
		})
	}

	sendEvent(event: IpcEventType, data: unknown): void {
		if (!this.process) return
		const message = IpcProtocol.createEvent(event, data)
		this.process.stdin?.write(IpcProtocol.serialize(message))
	}

	async stop(): Promise<void> {
		if (!this.process) return

		try {
			await this.send("dispose")
		} catch {
			// Ignore errors during dispose
		}

		this.process.kill("SIGTERM")
		this.process = null
		this.isReady = false
		this.rejectAllPending("IPC client stopped")
	}

	private rejectAllPending(reason: string): void {
		for (const [, { reject }] of this.pendingRequests) {
			reject(new Error(reason))
		}
		this.pendingRequests.clear()
	}

	private findBunBinary(): string | null {
		// Check common locations
		const candidates =
			process.platform === "win32"
				? ["bun.exe", "bun", path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe")]
				: ["bun", path.join(process.env.HOME || "", ".bun", "bin", "bun")]

		for (const candidate of candidates) {
			try {
				// Check if file exists and is executable
				if (fs.existsSync(candidate)) {
					return candidate
				}
			} catch {
				// Continue searching
			}
		}

		return null
	}

	getReady(): boolean {
		return this.isReady
	}
}
