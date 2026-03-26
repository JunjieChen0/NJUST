/**
 * Web Speech API — recognition types for VS Code / Electron webviews (Chromium).
 * Not always present in the default TypeScript DOM lib for this project.
 */

interface SpeechRecognitionAlternative {
	readonly transcript: string
}

interface SpeechRecognitionResult {
	readonly isFinal: boolean
	readonly length: number
	[index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
	readonly length: number
	[index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionErrorEvent extends Event {
	readonly error: string
}

interface SpeechRecognitionEvent extends Event {
	readonly resultIndex: number
	readonly results: SpeechRecognitionResultList
}

interface SpeechRecognition extends EventTarget {
	continuous: boolean
	interimResults: boolean
	lang: string
	start(): void
	stop(): void
	abort(): void
	onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
	onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
	onend: ((this: SpeechRecognition, ev: Event) => void) | null
}

interface SpeechRecognitionConstructor {
	new (): SpeechRecognition
}

interface Window {
	SpeechRecognition?: SpeechRecognitionConstructor
	webkitSpeechRecognition?: SpeechRecognitionConstructor
}
