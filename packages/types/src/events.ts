import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { modelInfoSchema } from "./model.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * NJUST_AI_CJEventName
 */

export enum NJUST_AI_CJEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Query Responses
	CommandsResponse = "commandsResponse",
	ModesResponse = "modesResponse",
	ModelsResponse = "modelsResponse",

	// Evals
	EvalPass = "evalPass",
	EvalFail = "evalFail",
}

/**
 * NJUST_AI_CJEvents
 */

export const rooCodeEventsSchema = z.object({
	[NJUST_AI_CJEventName.TaskCreated]: z.tuple([z.string()]),

	[NJUST_AI_CJEventName.TaskStarted]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[NJUST_AI_CJEventName.TaskAborted]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskFocused]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskUnfocused]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskActive]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskInteractive]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskResumable]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskIdle]: z.tuple([z.string()]),

	[NJUST_AI_CJEventName.TaskPaused]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskUnpaused]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[NJUST_AI_CJEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[NJUST_AI_CJEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[NJUST_AI_CJEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[NJUST_AI_CJEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[NJUST_AI_CJEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[NJUST_AI_CJEventName.TaskAskResponded]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.TaskUserMessage]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[NJUST_AI_CJEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[NJUST_AI_CJEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[NJUST_AI_CJEventName.ModeChanged]: z.tuple([z.string()]),
	[NJUST_AI_CJEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),

	[NJUST_AI_CJEventName.CommandsResponse]: z.tuple([
		z.array(
			z.object({
				name: z.string(),
				source: z.enum(["global", "project", "built-in"]),
				filePath: z.string().optional(),
				description: z.string().optional(),
				argumentHint: z.string().optional(),
			}),
		),
	]),
	[NJUST_AI_CJEventName.ModesResponse]: z.tuple([z.array(z.object({ slug: z.string(), name: z.string() }))]),
	[NJUST_AI_CJEventName.ModelsResponse]: z.tuple([z.record(z.string(), modelInfoSchema)]),
})

export type NJUST_AI_CJEvents = z.infer<typeof rooCodeEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskCreated),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskStarted),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskCompleted),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskAborted),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskFocused),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskUnfocused),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskActive),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskInteractive),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskResumable),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskIdle),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskPaused),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskUnpaused),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskSpawned),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskDelegated),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskDelegationCompleted),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskDelegationResumed),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.Message),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskModeSwitched),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskAskResponded),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.QueuedMessagesUpdated),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskToolFailed),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.TaskTokenUsageUpdated),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Query Responses
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.CommandsResponse),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.CommandsResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.ModesResponse),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.ModesResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.ModelsResponse),
		payload: rooCodeEventsSchema.shape[NJUST_AI_CJEventName.ModelsResponse],
		taskId: z.number().optional(),
	}),

	// Evals
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.EvalPass),
		payload: z.undefined(),
		taskId: z.number(),
	}),
	z.object({
		eventName: z.literal(NJUST_AI_CJEventName.EvalFail),
		payload: z.undefined(),
		taskId: z.number(),
	}),
])

export type TaskEvent = z.infer<typeof taskEventSchema>
