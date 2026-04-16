/**
 * Mode and provider-profile coordination (plan Task 5).
 * Incremental home for `handleModeSwitch` and profile plumbing currently on `ClineProvider`.
 */
export class ModeConfigService<THost = unknown> {
	constructor(readonly _host: THost) {}
}
