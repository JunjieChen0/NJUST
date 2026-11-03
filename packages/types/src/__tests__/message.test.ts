// pnpm --filter @njust-ai/types test src/__tests__/message.test.ts

import { clineAsks, isIdleAsk, isInteractiveAsk, isResumableAsk, isNonBlockingAsk } from "../message.js"
import { clineMessageSchema, verificationSummarySchema } from "../message.js"

describe("verification messages", () => {
	const minimal = {
		overall: "no_record",
		build: { state: "not_run" },
		test: { state: "not_run" },
		acceptance: "no_delivery",
	}
	test("accepts minimal and detailed system verification summaries", () => {
		expect(verificationSummarySchema.safeParse(minimal).success).toBe(true)
		expect(
			verificationSummarySchema.safeParse({
				...minimal,
				overall: "incomplete",
				build: { state: "stale", staleReason: "environment_changed", exitCode: 0, logPath: "/logs/build" },
				test: { state: "zero_tests", executed: 0 },
				changes: { taskTool: 1, other: 1, files: ["a.cj", "b.cj"], otherFiles: ["b.cj"] },
				claimId: "claim",
				note: "SDK changed",
				terminal: "error",
			}).success,
		).toBe(true)
	})
	test("reads old messages and standalone verification cards", () => {
		const old = { id: "m", ts: 1, type: "say", say: "completion_result", text: "Done" }
		expect(clineMessageSchema.safeParse(old).success).toBe(true)
		expect(
			clineMessageSchema.safeParse({ ...old, say: "verification_summary", verification: minimal }).success,
		).toBe(true)
	})
	test("retains code identity, command provenance and structured workflow progress", () => {
		const delivery = {
			projectRoot: "/project",
			fingerprint: "after",
			baselineFingerprint: "before",
			capturedAt: 1,
			files: [{ path: "src/main.cj", change: "modified", source: "task_tool" }],
			filesTruncated: false,
			diffOmittedPaths: [],
			diffPath: "/task/diff.patch",
		}
		expect(
			verificationSummarySchema.parse({
				...minimal,
				currentFingerprint: "after",
				delivery,
				build: {
					state: "passed",
					executable: "cjpm",
					args: ["build"],
					cwd: "/project",
					startedAt: 1,
					endedAt: 2,
				},
			}),
		).toMatchObject({ delivery, currentFingerprint: "after", build: { args: ["build"], cwd: "/project" } })
		expect(
			clineMessageSchema.parse({
				id: "p",
				ts: 1,
				type: "say",
				say: "cangjie_progress",
				cangjieProgress: { stage: "build", status: "waiting", at: 1, projectRoot: "/project" },
			}).cangjieProgress,
		).toMatchObject({ stage: "build", status: "waiting" })
	})
	test("rejects invalid states and overlong file lists", () => {
		expect(verificationSummarySchema.safeParse({ ...minimal, build: { state: "success" } }).success).toBe(false)
		expect(
			verificationSummarySchema.safeParse({
				...minimal,
				changes: { taskTool: 11, other: 0, files: Array(11).fill("file.cj") },
			}).success,
		).toBe(false)
	})
})

describe("ask messages", () => {
	test("all ask messages are classified", () => {
		for (const ask of clineAsks) {
			expect(
				isIdleAsk(ask) || isInteractiveAsk(ask) || isResumableAsk(ask) || isNonBlockingAsk(ask),
				`${ask} is not classified`,
			).toBe(true)
		}
	})
})
