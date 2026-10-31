// Type declarations for third-party modules

declare module "knuth-shuffle-seeded" {
	export default function knuthShuffle<T>(array: T[], seed: number | string): T[]
}

interface Window {
	AUDIO_BASE_URI?: string
	IMAGES_BASE_URI?: string
	MATERIAL_ICONS_BASE_URI?: string
}
