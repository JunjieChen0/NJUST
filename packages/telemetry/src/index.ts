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

export class TelemetryService {
	private static _instance: TelemetryService | undefined

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

	static createInstance(_options?: any): TelemetryService {
		TelemetryService._instance = new TelemetryService()
		return TelemetryService._instance
	}

	register(_client: any): void {
		// Stub - no-op
	}

	setProvider(_provider: TelemetryPropertiesProvider): void {
		// Stub - no-op
	}

	unsetProvider(): void {
		// Stub - no-op
	}

	shutdown(): void {
		// Stub - no-op
	}

	async sendEvent(_name: string, _properties?: Record<string, any>): Promise<void> {
		// Stub - no-op
	}

	async flush(): Promise<void> {
		// Stub - no-op
	}

	// Additional methods used in codebase
	captureTitleButtonClicked(_button: string): void {
		// Stub - no-op
	}

	captureTabShown(_tab: string): void {
		// Stub - no-op
	}

	captureError(_error: any, _properties?: Record<string, any>): void {
		// Stub - no-op
	}

	captureEvent(_name: string | { event: string; properties: any }, _properties?: Record<string, any>): void {
		// Stub - no-op
	}

	captureTelemetrySettingsChanged(_previous: string, _current: string): void {
		// Stub - no-op
	}

	captureModeSettingChanged(_mode: string, _source?: string): void {
		// Stub - no-op
	}

	captureCustomModeCreated(_slug: string, _name?: string): void {
		// Stub - no-op
	}

	captureConsecutiveMistakeError(_name: string): void {
		// Stub - no-op
	}

	captureException(_error: any, _context?: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureConversationMessage(_taskId: string, _role: string): void {
		// Stub - no-op
	}

	captureLlmCompletion(_taskId: string, _tokens: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; cost: number }): void {
		// Stub - no-op
	}

	captureDiffApplicationError(_taskId: string, _count: number): void {
		// Stub - no-op
	}

	captureTaskCompleted(_taskId: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureTaskCreated(_taskId: string): void {
		// Stub - no-op
	}

	captureTaskRestarted(_taskId: string): void {
		// Stub - no-op
	}

	captureCodeActionUsed(_action: string): void {
		// Stub - no-op
	}

	captureModeSwitch(_taskId: string, _mode: string): void {
		// Stub - no-op
	}

	captureToolUsage(_taskId: string | Record<string, any>, _tool?: string): void {
		// Stub - no-op
	}

	captureCheckpointCreated(_taskId: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureCheckpointRestored(_taskId: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureCheckpointDiffed(_taskId: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureContextCondensed(_taskId: string, _isAutomatic?: boolean, _hasCustomPrompt?: boolean): void {
		// Stub - no-op
	}

	captureSchemaValidationError(_properties?: Record<string, any>): void {
		// Stub - no-op
	}

	captureSlidingWindowTruncation(_taskId: string | Record<string, any>): void {
		// Stub - no-op
	}

	captureShellIntegrationError(_error: any): void {
		// Stub - no-op
	}

	updateTelemetryState(_isOptedIn: boolean): void {
		// Stub - no-op
	}
}

export class PostHogTelemetryClient {
	constructor(_options?: any) {
		// Stub - no-op
	}

	async start(): Promise<void> {
		// Stub - no-op
	}

	async stop(): Promise<void> {
		// Stub - no-op
	}

	async sendEvent(_name: string, _properties?: Record<string, any>): Promise<void> {
		// Stub - no-op
	}
}

export class TelemetryClient {
	constructor(_options?: any) {
		// Stub - no-op
	}

	async start(): Promise<void> {
		// Stub - no-op
	}

	async stop(): Promise<void> {
		// Stub - no-op
	}

	async sendEvent(_name: string, _properties?: Record<string, any>): Promise<void> {
		// Stub - no-op
	}
}
