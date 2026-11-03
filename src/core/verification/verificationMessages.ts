import type { ClineMessage, VerificationSummary } from "@njust-ai/types"

export function latestVerificationMessage(messages: readonly ClineMessage[]): ClineMessage | undefined {
	return [...messages]
		.reverse()
		.find(
			(message) =>
				message.verification && (message.say === "completion_result" || message.say === "verification_summary"),
		)
}

export function latestDeliveryMessage(messages: readonly ClineMessage[]): ClineMessage | undefined {
	return [...messages]
		.reverse()
		.find(
			(message) =>
				message.say === "completion_result" ||
				message.say === "verification_summary" ||
				(message.ask === "completion_result" && Boolean(message.text)),
		)
}

export async function refreshVerificationMessage(host: {
	clineMessages: ClineMessage[]
	currentSummary(): Promise<VerificationSummary | undefined>
	update(message: ClineMessage): Promise<unknown>
	save(): Promise<unknown>
}): Promise<void> {
	const summary = await host.currentSummary()
	const message = latestVerificationMessage(host.clineMessages)
	if (!summary || !message || (summary.claimId !== undefined && message.verification?.claimId !== summary.claimId))
		return
	message.verification = { ...summary, terminal: message.verification?.terminal }
	await host.update(message)
	await host.save()
}
