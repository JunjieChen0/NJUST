export type StartupProfileEntry = {
	name: string
	startedAt: number
	endedAt?: number
	durationMs?: number
}

class StartupProfiler {
	private entries: StartupProfileEntry[] = []

	start(name: string): void {
		this.entries.push({ name, startedAt: Date.now() })
	}

	end(name: string): void {
		const candidate = [...this.entries].reverse().find((e) => e.name === name && e.endedAt === undefined)
		if (!candidate) return
		candidate.endedAt = Date.now()
		candidate.durationMs = candidate.endedAt - candidate.startedAt
	}

	summary(): StartupProfileEntry[] {
		return this.entries.map((e) => ({ ...e }))
	}
}

export const startupProfiler = new StartupProfiler()
