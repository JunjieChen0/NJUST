export interface ResourceLimitsConfig {
	maxReadBytes: number
	maxWriteBytes: number
	maxOpenFileHandles: number
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimitsConfig = {
	maxReadBytes: 50 * 1024 * 1024,
	maxWriteBytes: 20 * 1024 * 1024,
	maxOpenFileHandles: 10,
}

export interface ResourceUsage {
	readBytes: number
	writeBytes: number
	openFileHandles: number
}

export class ResourceLimitExceededError extends Error {
	constructor(
		message: string,
		readonly limit: keyof ResourceLimitsConfig,
		readonly requested: number,
		readonly available: number,
	) {
		super(message)
		this.name = "ResourceLimitExceededError"
	}
}

/**
 * Per-request resource budget tracker.
 *
 * This is a **single-request** budget — each MCP tool invocation gets its own
 * instance via `createPerRequestResourceLimits()`. It does NOT limit resources
 * across concurrent requests. For global concurrent limits, a server-level
 * shared semaphore would be needed.
 *
 * The `maxOpenFileHandles` counter tracks handles opened under THIS instance's
 * budget, not the process-wide file descriptor count.
 */
export class ResourceLimitsService {
	private config: ResourceLimitsConfig
	private readBytesUsed = 0
	private writeBytesUsed = 0
	private openFileHandles = 0
	private disposed = false

	constructor(config: Partial<ResourceLimitsConfig> = {}) {
		this.config = { ...DEFAULT_RESOURCE_LIMITS, ...config }
	}

	getUsage(): ResourceUsage {
		return {
			readBytes: this.readBytesUsed,
			writeBytes: this.writeBytesUsed,
			openFileHandles: this.openFileHandles,
		}
	}

	acquireReadBytes(requested: number): number {
		if (this.disposed) return 0
		if (requested <= 0) return 0
		const remaining = this.config.maxReadBytes - this.readBytesUsed
		if (remaining <= 0) return 0
		const granted = Math.min(requested, remaining)
		this.readBytesUsed += granted
		return granted
	}

	releaseReadBytes(n: number): void {
		if (n <= 0) return
		this.readBytesUsed = Math.max(0, this.readBytesUsed - n)
	}

	acquireWriteBytes(requested: number): number {
		if (this.disposed) return 0
		if (requested <= 0) return 0
		const remaining = this.config.maxWriteBytes - this.writeBytesUsed
		if (remaining <= 0) return 0
		const granted = Math.min(requested, remaining)
		this.writeBytesUsed += granted
		return granted
	}

	releaseWriteBytes(n: number): void {
		if (n <= 0) return
		this.writeBytesUsed = Math.max(0, this.writeBytesUsed - n)
	}

	acquireFileHandle(): boolean {
		if (this.disposed) return false
		if (this.openFileHandles >= this.config.maxOpenFileHandles) return false
		this.openFileHandles++
		return true
	}

	releaseFileHandle(): void {
		this.openFileHandles = Math.max(0, this.openFileHandles - 1)
	}

	dispose(): void {
		this.disposed = true
		this.readBytesUsed = 0
		this.writeBytesUsed = 0
		this.openFileHandles = 0
	}

	isDisposed(): boolean {
		return this.disposed
	}
}

export function createPerRequestResourceLimits(config?: Partial<ResourceLimitsConfig>): ResourceLimitsService {
	return new ResourceLimitsService(config)
}
