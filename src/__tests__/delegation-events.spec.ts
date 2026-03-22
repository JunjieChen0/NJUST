// npx vitest run __tests__/delegation-events.spec.ts

import { NJUST_AI_CJEventName, rooCodeEventsSchema, taskEventSchema } from "@roo-code/types"

describe("delegation event schemas", () => {
	test("rooCodeEventsSchema validates tuples", () => {
		expect(() => (rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegated].parse(["p", "c"])).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() => (rooCodeEventsSchema.shape as any)[NJUST_AI_CJEventName.TaskDelegationResumed].parse(["p"])).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: NJUST_AI_CJEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: NJUST_AI_CJEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: NJUST_AI_CJEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
