export interface VerificationFeedback {
	text: string
	images?: string[]
}

export interface VerificationApproval {
	approved: boolean
	feedback?: VerificationFeedback
}

export function verificationApprovalFromResponse(response: {
	response: string
	text?: string
	images?: string[]
}): VerificationApproval {
	return response.response === "messageResponse"
		? { approved: false, feedback: { text: response.text ?? "", images: response.images } }
		: { approved: response.response === "yesButtonClicked" }
}

/** Carries user input out of the build/test runner before a delivery is recorded. */
export class VerificationFeedbackError extends Error {
	constructor(readonly feedback: VerificationFeedback) {
		super("User supplied additional instructions during verification approval")
	}
}
