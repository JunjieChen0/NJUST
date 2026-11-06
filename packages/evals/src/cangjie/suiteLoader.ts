import * as fs from "node:fs/promises"
import * as path from "node:path"
import { z } from "zod"
import { CANGJIE_TASK_SUITE, type CangjieTaskSuite } from "./suite.js"

const relativePath = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("\\") &&
			!value.includes(":") &&
			!value.startsWith("/") &&
			value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
		"Use a relative path without traversal",
	)
const files = z.record(relativePath, z.string())
const taskSchema = z
	.object({
		id: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
		project: z.string().regex(/^[A-Za-z0-9_-]+$/),
		category: z.enum(["locate", "feature", "repair", "safety"]),
		prompt: z.string().min(1),
		startingPoint: z.enum(["clean", "compile-error", "test-failure", "dependency-interface"]),
		allowedChanges: z.array(relativePath),
		requiredAssertions: z
			.array(
				z.enum([
					"source-unchanged",
					"no-unapproved-command",
					"report-correct",
					"oracle-passed",
					"system-verified",
					"allowed-diff",
					"delivery-bound-to-code",
					"tests-added",
					"tests-not-weakened",
					"initial-build-failed",
					"initial-test-failed",
					"build-failure-reported",
					"not-falsely-verified",
					"no-secret-leak",
				]),
			)
			.min(1),
		initialFiles: files.optional(),
		oracleFiles: files.optional(),
		testProjects: z
			.array(z.union([z.literal("."), relativePath]))
			.min(1)
			.optional(),
		reportIncludes: z.array(z.string().min(1)).min(1).optional(),
		reportFacts: z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()])).optional(),
	})
	.strict()

const suiteSchema = z
	.object({
		version: z.string().min(1),
		sdkVersion: z.string().min(1),
		concurrency: z.literal(1),
		performanceThreshold: z.null(),
		safetyFailuresAllowed: z.literal(0),
		cases: z.array(taskSchema).min(1),
	})
	.strict()
	.superRefine((suite, context) => {
		const ids = new Set<string>()
		for (const task of suite.cases) {
			if (ids.has(task.id)) context.addIssue({ code: "custom", message: `Duplicate task ID: ${task.id}` })
			ids.add(task.id)
			if (task.startingPoint !== "clean" && !Object.keys(task.initialFiles ?? {}).length)
				context.addIssue({
					code: "custom",
					message: `${task.id} requires initialFiles for its failing starting point`,
				})
			if (["feature", "repair"].includes(task.category) && !task.requiredAssertions.includes("oracle-passed"))
				context.addIssue({ code: "custom", message: `${task.id} requires an independent oracle assertion` })
			if (task.requiredAssertions.includes("oracle-passed") && !Object.keys(task.oracleFiles ?? {}).length)
				context.addIssue({ code: "custom", message: `${task.id} requires hidden test files` })
			if (task.requiredAssertions.includes("report-correct") && !Object.keys(task.reportFacts ?? {}).length)
				context.addIssue({ code: "custom", message: `${task.id} requires reportFacts` })
		}
	})

export function parseCangjieTaskSuite(value: unknown): CangjieTaskSuite {
	return suiteSchema.parse(value)
}

export async function loadCangjieTaskSuite(repo: string, manifest?: string) {
	if (!manifest)
		return {
			suite: CANGJIE_TASK_SUITE as CangjieTaskSuite,
			projects: path.join(repo, "packages/evals/cangjie/projects"),
		}
	const absolute = path.resolve(manifest)
	return {
		suite: parseCangjieTaskSuite(JSON.parse(await fs.readFile(absolute, "utf8"))),
		projects: path.join(path.dirname(absolute), "projects"),
	}
}
