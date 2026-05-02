import * as fs from "fs"
import * as path from "path"

export interface LogEntry {
	t: number // timestamp
	n: string // event name
	p?: Record<string, unknown> // properties (already sanitized)
}

export class TelemetryLogger {
	private filePath: string
	private stream: fs.WriteStream | null = null
	private entries: number = 0
	private maxEntries: number

	constructor(baseDir: string, maxEntries: number = 10000) {
		this.maxEntries = maxEntries
		const dir = path.join(baseDir, "telemetry")
		fs.mkdirSync(dir, { recursive: true })
		const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
		this.filePath = path.join(dir, `events-${date}.ndjson`)
	}

	private ensureStream(): fs.WriteStream {
		if (!this.stream) {
			this.stream = fs.createWriteStream(this.filePath, { flags: "a" })
		}
		return this.stream
	}

	log(entry: LogEntry): void {
		if (this.entries >= this.maxEntries) {
			return // silently drop — prevent unbounded growth
		}
		const line = JSON.stringify(entry) + "\n"
		this.ensureStream().write(line)
		this.entries++
	}

	flush(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.stream) {
				resolve()
				return
			}
			this.stream.end(resolve)
			this.stream = null
		})
	}

	dispose(): void {
		if (this.stream) {
			this.stream.end()
			this.stream = null
		}
	}

	get currentFilePath(): string {
		return this.filePath
	}
}
