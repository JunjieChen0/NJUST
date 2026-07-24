export type CangjieAgentStage = "CangjieExplore" | "CangjieImplement" | "CangjieVerify" | "CangjieRepair"

export type CangjieAgentRouteKind = "explore" | "implement" | "verify" | "repair"

export interface CangjieAgentRoute {
	kind: CangjieAgentRouteKind
	stages: CangjieAgentStage[]
	reason: string
}

export interface CangjieAgentRoutingOptions {
	repairRequired?: boolean
	freshEvidenceRequired?: boolean
}

const REAL_DIAGNOSTIC_PATTERNS = [
	/\bcjpm\s+(?:build|check)\s+(?:failed|failure|error)/i,
	/\bcjc\b[^\n]*(?:error|failed)/i,
	/\bcjlint\b[^\n]*(?:error|failed)/i,
	/\berror(?:\[[^\]]+\])?:/i,
	/==>\s+[^\n]+\.cj:\d+:/i,
	/\u7f16\u8bd1\u5931\u8d25|\u6784\u5efa\u5931\u8d25|\u771f\u5b9e\u9519\u8bef\u8f93\u51fa|\u6839\u636e(?:\u8fd9\u4e2a|\u4ee5\u4e0b)?\u62a5\u9519\u4fee\u590d/,
]

const VERIFY_ONLY_PATTERNS = [
	/\bonly\s+run\b/i,
	/\b(?:run|execute)\s+(?:only\s+)?(?:cjpm|cjc|cjlint)\b/i,
	/\bverify\b|\bverification\b/i,
	/\u53ea\u8fd0\u884c|\u4ec5\u8fd0\u884c|\u9a8c\u8bc1(?:\u9879\u76ee|\u6784\u5efa)?|\u68c0\u67e5\u662f\u5426\u7f16\u8bd1|\u6d4b\u8bd5\u5b8c\u4e86/,
]

const EVIDENCE_ONLY_PATTERNS = [
	/\b(?:evidence|investigate|research|audit)\b/i,
	/\bdo not (?:modify|edit|write|run)\b/i,
	/\u8c03\u67e5|\u67e5(?:\u627e|\u8bc1|\u4e00\u4e0b)(?:\u8d44\u6599|\u8bc1\u636e|\u8bed\u6599|\u6587\u6863)|\u8bc1\u636e\u62a5\u544a|\u4e0d\u8981\u4fee\u6539|\u4e0d\u4fee\u6539\u6587\u4ef6|\u5b9e\u73b0\u524d/,
]

const IMPLEMENT_PATTERNS = [
	/\b(?:add|create|implement|modify|edit|write|refactor|fix)\b/i,
	/\u65b0\u589e|\u6dfb\u52a0|\u5b9e\u73b0|\u4fee\u6539|\u521b\u5efa|\u7f16\u5199|\u91cd\u6784|\u4fee\u590d|\u5e2e\u6211\u5199|\u76f4\u63a5\u6539/,
]

const TOOLCHAIN_COMMAND_PATTERN = /\b(?:cjpm\s+(?:build|check|test)|cjc|cjlint)\b/i

export function routeCangjieAgentTask(userMessage: string): CangjieAgentRoute {
	const text = userMessage.trim()
	const hasImplementationIntent = IMPLEMENT_PATTERNS.some((pattern) => pattern.test(text))

	if (REAL_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			kind: "repair",
			stages: ["CangjieRepair", "CangjieVerify"],
			reason: "The request includes real Cangjie toolchain diagnostics, so repair must be narrow and re-verified.",
		}
	}

	if (
		!hasImplementationIntent &&
		(VERIFY_ONLY_PATTERNS.some((pattern) => pattern.test(text)) || TOOLCHAIN_COMMAND_PATTERN.test(text))
	) {
		return {
			kind: "verify",
			stages: ["CangjieVerify"],
			reason: "The request is verification-only and does not require source edits.",
		}
	}

	if (!hasImplementationIntent && EVIDENCE_ONLY_PATTERNS.some((pattern) => pattern.test(text))) {
		return {
			kind: "explore",
			stages: ["CangjieExplore"],
			reason: "The request asks for evidence or investigation without implementation.",
		}
	}

	if (hasImplementationIntent) {
		return {
			kind: "implement",
			stages: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
			reason: "The request changes a Cangjie project and therefore needs evidence, implementation, and verification.",
		}
	}

	return {
		kind: "explore",
		stages: ["CangjieExplore"],
		reason: "The request does not clearly require edits or toolchain execution, so start read-only.",
	}
}

export function buildCangjieAgentRoutingSection(
	userMessage: string,
	completedStages: string[] = [],
	options: CangjieAgentRoutingOptions = {},
): string {
	const route = routeCangjieAgentTask(userMessage)
	let plannedStages: CangjieAgentStage[] = [...route.stages]
	if (options.repairRequired) {
		plannedStages = [...completedStages] as CangjieAgentStage[]
		const lastStage = completedStages.at(-1)
		if (lastStage === "CangjieRepair") {
			plannedStages.push("CangjieVerify")
		} else {
			if (options.freshEvidenceRequired && lastStage !== "CangjieExplore") {
				plannedStages.push("CangjieExplore")
			}
			plannedStages.push("CangjieRepair", "CangjieVerify")
		}
	}
	let completedPrefixLength = 0
	while (
		completedPrefixLength < completedStages.length &&
		completedStages[completedPrefixLength] === plannedStages[completedPrefixLength]
	) {
		completedPrefixLength += 1
	}
	const pendingStages = plannedStages.slice(completedPrefixLength)
	const nextStage = pendingStages[0]
	return [
		"## Cangjie Agent Route",
		`- Route kind: ${options.repairRequired ? "repair" : route.kind}`,
		`- Planned stages: ${plannedStages.join(" -> ")}`,
		`- Completed stages: ${completedStages.join(" -> ") || "none"}`,
		`- Required stages: ${pendingStages.join(" -> ") || "none"}`,
		`- Next stage: ${nextStage ?? "none; finish the parent task without another delegation"}`,
		`- Reason: ${
			options.repairRequired
				? "The latest CangjieVerify build failed, so the diagnostics require a narrow repair and another verification."
				: route.reason
		}`,
		nextStage
			? `- You MUST now use the \`agent\` tool with agentType \`${nextStage}\` before using stage-specific tools yourself.`
			: "- All planned stages are complete. Do not call another agent for this unchanged request.",
		"- Do not repeat a completed stage unless new diagnostics or edits require it.",
	].join("\n")
}
