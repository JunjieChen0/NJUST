import { TelemetryLogger, type LogEntry } from "./TelemetryLogger.js"

export class TelemetryBatcher {
	private logger: TelemetryLogger
	private queue: LogEntry[] = []
	private readonly batchSize: number
	private readonly flushIntervalMs: number
	private timer: ReturnType<typeof setInterval> | null = null
	private flushed: boolean = false

	constructor(
		logger: TelemetryLogger,
		batchSize: number = 100,
		flushIntervalMs: number = 30000,
	) {
		this.logger = logger
		this.batchSize = batchSize
		this.flushIntervalMs = flushIntervalMs
	}

	start(): void {
		if (this.timer) return
		this.timer = setInterval(() => this.flush(), this.flushIntervalMs)
		if (typeof this.timer === "object" && typeof this.timer.unref === "function") {
			this.timer.unref() // don't keep process alive just for telemetry
		}
	}

	enqueue(entry: LogEntry): void {
		this.queue.push(entry)
		if (this.queue.length >= this.batchSize) {
			this.flush()
		}
	}

	flush(): void {
		if (this.queue.length === 0) return
		const batch = this.queue
		this.queue = []
		for (const entry of batch) {
			this.logger.log(entry)
		}
	}

	async shutdown(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
		this.flush()
		await this.logger.flush()
		this.flushed = true
	}

	get hasFlushed(): boolean {
		return this.flushed
	}
}
