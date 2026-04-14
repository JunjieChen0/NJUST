export type TokenGrowthSnapshot = {
	windowSize: number
	averageGrowth: number
	emaGrowth: number
	predictedNextTokens: number
	isAccelerating: boolean
}

export class TokenGrowthTracker {
	private readonly maxWindowSize: number
	private readonly emaAlpha: number
	private samples: number[] = []
	private emaGrowth: number | undefined

	constructor(config?: { maxWindowSize?: number; emaAlpha?: number }) {
		this.maxWindowSize = Math.max(3, config?.maxWindowSize ?? 5)
		this.emaAlpha = Math.min(1, Math.max(0.05, config?.emaAlpha ?? 0.35))
	}

	addSample(contextTokens: number): void {
		if (!Number.isFinite(contextTokens) || contextTokens < 0) return
		this.samples.push(contextTokens)
		if (this.samples.length > this.maxWindowSize + 1) {
			this.samples.shift()
		}

		if (this.samples.length >= 2) {
			const latestGrowth = this.samples[this.samples.length - 1] - this.samples[this.samples.length - 2]
			if (this.emaGrowth === undefined) {
				this.emaGrowth = latestGrowth
			} else {
				this.emaGrowth = this.emaAlpha * latestGrowth + (1 - this.emaAlpha) * this.emaGrowth
			}
		}
	}

	getSnapshot(): TokenGrowthSnapshot | undefined {
		if (this.samples.length < 2) return undefined
		const growths: number[] = []
		for (let i = 1; i < this.samples.length; i++) {
			growths.push(this.samples[i] - this.samples[i - 1])
		}
		const averageGrowth = growths.reduce((sum, g) => sum + g, 0) / growths.length
		const emaGrowth = this.emaGrowth ?? averageGrowth
		const current = this.samples[this.samples.length - 1]
		const predictedNextTokens = Math.max(0, Math.round(current + emaGrowth))
		const recentGrowth = growths[growths.length - 1]
		const isAccelerating = recentGrowth > averageGrowth * 1.15 && recentGrowth > 0

		return {
			windowSize: growths.length,
			averageGrowth,
			emaGrowth,
			predictedNextTokens,
			isAccelerating,
		}
	}

	reset(): void {
		this.samples = []
		this.emaGrowth = undefined
	}
}
