export interface TelemetryEvent {
	name: string
	properties?: Record<string, any>
}

export interface TelemetryProperties {
	[key: string]: any
}

export type TelemetryPropertiesProvider = () => TelemetryProperties | Promise<TelemetryProperties>

export interface StaticAppProperties {
	[key: string]: any
}

export interface DynamicAppProperties {
	[key: string]: any
}

interface OTelSpanLike {
	addEvent(name: string, attributes?: Record<string, any>): void
	setAttribute?(key: string, value: any): void
	recordException?(error: unknown): void
	setStatus?(status: { code: number; message?: string }): void
	end(endTime?: number): void
}

interface TelemetryInitOptions {
	serviceName?: string
	enableOtel?: boolean
}

export class TelemetryService {
	private static _instance: TelemetryService | undefined
	private provider?: TelemetryPropertiesProvider
	private otelApi: any | undefined
	private tracer: any | undefined
	private spanStore = new Map<string, OTelSpanLike>()
	private otelEnabled = false
	private otelInitStarted = false

	static get instance(): TelemetryService {
		if (!TelemetryService._instance) {
			TelemetryService._instance = new TelemetryService()
		}
		return TelemetryService._instance
	}

	static hasInstance(): boolean {
		return !!TelemetryService._instance
	}

	static getInstance(): TelemetryService {
		return TelemetryService.instance
	}

	static createInstance(options?: TelemetryInitOptions): TelemetryService {
		TelemetryService._instance = new TelemetryService()
		void TelemetryService._instance.initializeOtel(options)
		return TelemetryService._instance
	}

	private async initializeOtel(options?: TelemetryInitOptions): Promise<void> {
		if (this.otelInitStarted) {
			return
		}
		this.otelInitStarted = true
		if (options?.enableOtel === false) {
			this.otelEnabled = false
			return
		}
		try {
			const moduleName = "@opentelemetry/api"
			const dynamicImporter = new Function("m", "return import(m)") as (m: string) => Promise<any>
			const otelApi = await dynamicImporter(moduleName)
			this.otelApi = otelApi
			this.tracer = otelApi.trace.getTracer(options?.serviceName || "roo-code")
			this.otelEnabled = true
		} catch {
			this.otelEnabled = false
		}
	}

	register(_client: any): void {
		// no-op
	}

	setProvider(provider: TelemetryPropertiesProvider): void {
		this.provider = provider
	}

	unsetProvider(): void {
		this.provider = undefined
	}

	shutdown(): void {
		for (const [, span] of this.spanStore) {
			try {
				span.end()
			} catch {
				// no-op
			}
		}
		this.spanStore.clear()
	}

	async sendEvent(name: string, properties?: Record<string, any>): Promise<void> {
		this.captureEvent(name, properties)
	}

	async flush(): Promise<void> {
		// no-op
	}

	startSpan(name: string, attrs?: Record<string, any>): { traceId: string; spanId: string } | undefined {
		if (!this.otelEnabled || !this.tracer || !this.otelApi) {
			void this.initializeOtel()
			if (!this.otelEnabled || !this.tracer || !this.otelApi) {
				return undefined
			}
		}
		const span = this.tracer.startSpan(name)
		for (const [k, v] of Object.entries(attrs ?? {})) {
			span.setAttribute?.(k, v)
		}
		const ctx = span.spanContext?.() as { traceId?: string; spanId?: string } | undefined
		const traceId = ctx?.traceId ?? `${Date.now()}-trace`
		const spanId = ctx?.spanId ?? `${Date.now()}-span`
		this.spanStore.set(spanId, span as OTelSpanLike)
		return { traceId, spanId }
	}

	endSpan(spanId: string, status?: "ok" | "error", attrs?: Record<string, any>): void {
		const span = this.spanStore.get(spanId)
		if (!span) {
			return
		}
		for (const [k, v] of Object.entries(attrs ?? {})) {
			span.setAttribute?.(k, v)
		}
		if (status === "error") {
			span.setStatus?.({ code: 2 })
		} else if (status === "ok") {
			span.setStatus?.({ code: 1 })
		}
		span.end()
		this.spanStore.delete(spanId)
	}

	captureTitleButtonClicked(_button: string): void {}
	captureTabShown(_tab: string): void {}
	captureError(_error: any, _properties?: Record<string, any>): void {}
	captureTelemetrySettingsChanged(_previous: string, _current: string): void {}
	captureModeSettingChanged(_mode: string, _source?: string): void {}
	captureCustomModeCreated(_slug: string, _name?: string): void {}
	captureConsecutiveMistakeError(_name: string): void {}
	captureException(_error: any, _context?: string | Record<string, any>): void {}
	captureConversationMessage(_taskId: string, _role: string): void {}
	captureLlmCompletion(_taskId: string, _tokens: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; cost: number }): void {}
	captureDiffApplicationError(_taskId: string, _count: number): void {}
	captureTaskCompleted(_taskId: string | Record<string, any>): void {}
	captureTaskCreated(_taskId: string): void {}
	captureTaskRestarted(_taskId: string): void {}
	captureCodeActionUsed(_action: string): void {}
	captureModeSwitch(_taskId: string, _mode: string): void {}
	captureToolUsage(_taskId: string | Record<string, any>, _tool?: string): void {}
	captureCheckpointCreated(_taskId: string | Record<string, any>): void {}
	captureCheckpointRestored(_taskId: string | Record<string, any>): void {}
	captureCheckpointDiffed(_taskId: string | Record<string, any>): void {}
	captureContextCondensed(_taskId: string, _isAutomatic?: boolean, _hasCustomPrompt?: boolean): void {}
	captureSchemaValidationError(_properties?: Record<string, any>): void {}
	captureSlidingWindowTruncation(_taskId: string | Record<string, any>): void {}
	captureShellIntegrationError(_error: any): void {}
	updateTelemetryState(_isOptedIn: boolean): void {}

	captureEvent(name: string | { event: string; properties: any }, properties?: Record<string, any>): void {
		const evtName = typeof name === "string" ? name : name.event
		const evtProps = typeof name === "string" ? properties : name.properties
		if (!this.otelEnabled || !this.tracer) {
			return
		}
		try {
			const span = this.tracer.startSpan(`event.${evtName}`)
			for (const [k, v] of Object.entries(evtProps ?? {})) {
				span.setAttribute?.(k, v)
			}
			span.addEvent(evtName, evtProps ?? {})
			span.end()
		} catch {
			// no-op
		}
	}
}

export class PostHogTelemetryClient {
	constructor(_options?: any) {}
	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async sendEvent(_name: string, _properties?: Record<string, any>): Promise<void> {}
}

export class TelemetryClient {
	constructor(_options?: any) {}
	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async sendEvent(_name: string, _properties?: Record<string, any>): Promise<void> {}
}
