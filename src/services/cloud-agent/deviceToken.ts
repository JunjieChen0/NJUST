/**
 * In-memory device token holder for Cloud Agent.
 * Token is persisted via SecretStorage; this module avoids leaking
 * it to VS Code settings.json through configuration writes.
 */
let deviceToken: string | undefined

export function setDeviceToken(token: string): void {
	deviceToken = token
}

export function getDeviceToken(): string {
	return deviceToken ?? ""
}
