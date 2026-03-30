/**
 * Build a webview-safe URL for files under the extension's `assets/images` folder.
 * Uses `window.IMAGES_BASE_URI` injected by ClineProvider (CSP allows only this origin for local images).
 */
export function getExtensionImageUrl(filename: string): string {
	const base = (window as unknown as { IMAGES_BASE_URI?: string }).IMAGES_BASE_URI ?? ""
	return base ? `${base}/${filename}` : ""
}
