import * as fs from "fs/promises"
import * as path from "path"
import { createTwoFilesPatch } from "diff"
import { z } from "zod"
import { createHash } from "crypto"
import type { VerificationDelivery } from "@njust-ai/types"
import type { ProjectSnapshot } from "./projectFingerprint"
import { attributeChanges, diffSnapshots } from "./changeAttribution"
import { logger } from "../../shared/logger"
import { canonicalVerificationPath } from "./projectRoot"

const MAX_FILE_BYTES = 256 * 1024
const MAX_BASELINE_BYTES = 4 * 1024 * 1024
const BASELINE_FILE = "delivery-baseline.json"
const sensitiveName = /(?:^\.env(?:\.|$)|secret|credential|private.?key|^id_(?:rsa|ed25519)$)/i
const baselineSchema = z.object({
	root: z.string(),
	fingerprint: z.string(),
	files: z.record(z.string(), z.string()),
	texts: z.record(z.string(), z.string()),
})

async function readableText(file: string): Promise<string | undefined> {
	if (sensitiveName.test(path.basename(file))) return undefined
	const stat = await fs.stat(file)
	if (stat.size > MAX_FILE_BYTES) return undefined
	const content = await fs.readFile(file)
	return content.includes(0) ? undefined : content.toString("utf8")
}

/** Saved before the model's first request; no build command or source write is performed. */
export async function captureDeliveryBaseline(
	taskDir: string,
	root: string,
	snapshot: ProjectSnapshot,
	includeText = true,
	signal?: AbortSignal,
): Promise<void> {
	const file = path.join(taskDir, BASELINE_FILE)
	try {
		await fs.access(file)
		return
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		logger.debug("TaskDelivery", "Capturing initial project inputs")
	}
	const texts: Record<string, string> = {}
	let bytes = 0
	for (const relative of includeText ? Object.keys(snapshot.files) : []) {
		if (signal?.aborted) return
		try {
			const text = await readableText(path.resolve(root, relative))
			if (
				text !== undefined &&
				createHash("sha256").update(text).digest("hex") === snapshot.files[relative] &&
				bytes + Buffer.byteLength(text) <= MAX_BASELINE_BYTES
			) {
				texts[relative] = text
				bytes += Buffer.byteLength(text)
			}
		} catch (error) {
			logger.debug("TaskDelivery", "Initial text unavailable", error)
		}
	}
	if (signal?.aborted) return
	await fs.mkdir(taskDir, { recursive: true })
	await fs
		.writeFile(
			file,
			JSON.stringify({
				root: await fs.realpath(root),
				fingerprint: snapshot.fingerprint,
				files: snapshot.files,
				texts,
			}),
			{ encoding: "utf8", flag: "wx" },
		)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST") throw error
			logger.debug("TaskDelivery", "Initial project inputs already saved")
		})
}

export async function buildTaskDelivery(
	taskDir: string,
	root: string,
	snapshot: ProjectSnapshot,
	writtenPaths: string[],
	claimId: string,
	at: number,
): Promise<VerificationDelivery> {
	const empty: VerificationDelivery = {
		projectRoot: root,
		fingerprint: snapshot.fingerprint,
		capturedAt: at,
		files: [],
		filesTruncated: false,
		diffOmittedPaths: [],
	}
	let baseline: z.infer<typeof baselineSchema>
	try {
		baseline = baselineSchema.parse(JSON.parse(await fs.readFile(path.join(taskDir, BASELINE_FILE), "utf8")))
		if (baseline.root !== (await fs.realpath(root)))
			throw new Error("Project root changed since initial input capture")
	} catch (error) {
		logger.debug("TaskDelivery", "Initial project inputs unavailable; no diff can be claimed", error)
		return { ...empty, diffOmittedPaths: ["Initial project snapshot was not captured before edits"] }
	}
	const previous: ProjectSnapshot = {
		fingerprint: baseline.fingerprint,
		files: baseline.files,
		coverage: "complete",
		gaps: [],
	}
	const canonicalWrites = await Promise.all(writtenPaths.map(canonicalVerificationPath))
	const changes = attributeChanges(diffSnapshots(previous, snapshot), await fs.realpath(root), canonicalWrites)
	const patches: string[] = []
	const omitted: string[] = []
	let bytes = 0
	for (const change of changes) {
		try {
			const before = change.change === "added" ? "" : baseline.texts[change.path]
			const after = change.change === "deleted" ? "" : await readableText(path.resolve(root, change.path))
			if (
				after !== undefined &&
				change.change !== "deleted" &&
				createHash("sha256").update(after).digest("hex") !== snapshot.files[change.path]
			) {
				omitted.push(change.path)
				continue
			}
			if (
				before === undefined ||
				after === undefined ||
				bytes + Buffer.byteLength(before) + Buffer.byteLength(after) > MAX_BASELINE_BYTES
			) {
				omitted.push(change.path)
				continue
			}
			const patch = createTwoFilesPatch(`a/${change.path}`, `b/${change.path}`, before, after)
			patches.push(patch)
			bytes += Buffer.byteLength(patch)
		} catch (error) {
			logger.debug("TaskDelivery", "Changed file text unavailable", error)
			omitted.push(change.path)
		}
	}
	const diffPath = path.join(taskDir, "delivery-diffs", `${claimId}.patch`)
	await fs.mkdir(path.dirname(diffPath), { recursive: true })
	await fs.writeFile(diffPath, patches.join("\n"), "utf8")
	return {
		...empty,
		baselineFingerprint: baseline.fingerprint,
		files: changes.slice(0, 100),
		filesTruncated: changes.length > 100,
		diffPath,
		diffOmittedPaths: omitted,
	}
}
