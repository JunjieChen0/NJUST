export type QueryProfilePoint = {
	requestId: string
	taskId: string
	modelId: string
	startedAt: number
	firstTokenAt?: number
	finishedAt?: number
	aborted?: boolean
	error?: string
}

export type QueryProfileResult = {
	requestId: string
	taskId: string
	modelId: string
	ttftMs?: number
	e2eMs?: number
	aborted: boolean
	error?: string
}

class QueryProfiler {
	private points = new Map<string, QueryProfilePoint>()

	start(point: QueryProfilePoint): void {
		this.points.set(point.requestId, point)
	}

	markFirstToken(requestId: string): void {
		const p = this.points.get(requestId)
		if (!p || p.firstTokenAt) return
		p.firstTokenAt = Date.now()
	}

	finish(requestId: string, opts?: { aborted?: boolean; error?: string }): QueryProfileResult | undefined {
		const p = this.points.get(requestId)
		if (!p) return undefined
		p.finishedAt = Date.now()
		p.aborted = opts?.aborted ?? false
		p.error = opts?.error
		this.points.delete(requestId)

		return {
			requestId: p.requestId,
			taskId: p.taskId,
			modelId: p.modelId,
			ttftMs: p.firstTokenAt ? p.firstTokenAt - p.startedAt : undefined,
			e2eMs: p.finishedAt - p.startedAt,
			aborted: p.aborted,
			error: p.error,
		}
	}
}

export const globalQueryProfiler = new QueryProfiler()
