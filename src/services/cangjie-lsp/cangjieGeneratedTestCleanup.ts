import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"
import type { Memento } from "vscode"
import { TelemetryEventName } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"

import { logger } from "../../shared/logger"
import { logSecurityEvent } from "../../shared/security-audit"

export const WORKSPACE_STATE_KEY = "cangjie.generatedTestFiles"
export const NO_TASK_KEY = "__no_task__"

export type FileStatus = "active" | "detached" | "deleted" | "legacy"

const VALID_STATUSES: ReadonlySet<string> = new Set(["active", "detached", "deleted", "legacy"])
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export interface GeneratedFileRecord {
	taskId: string
	status: FileStatus
	workspaceRoot: string
	absolutePath: string
	contentSha256?: string
	createdAt: number
	kind: "cangjie-test"
}

export interface CleanupResult {
	deleted: string[]
	skippedModified: string[]
	skippedOutsideWorkspace: string[]
	skippedLegacyNotConfirmed: string[]
	skippedInvalid: string[]
	failed: Array<{ path: string; error: string }>
}

export interface ScanResult {
	active: GeneratedFileRecord[]
	detached: GeneratedFileRecord[]
	legacy: GeneratedFileRecord[]
}

export interface ReassociateResult {
	reassociated: number
	outsideWorkspace: number
}

const byTaskId = new Map<string, Map<string, GeneratedFileRecord>>()

let workspaceState: Memento | undefined

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0
}

function validateRecord(raw: unknown, expectedTaskId: string): GeneratedFileRecord | null {
	if (typeof raw !== "object" || raw === null) return null

	const r = raw as Record<string, unknown>

	if (!isNonEmptyString(r.taskId) || r.taskId !== expectedTaskId) return null
	if (!isNonEmptyString(r.absolutePath)) return null
	if (typeof r.workspaceRoot !== "string") return null

	if (typeof r.status !== "string" || !VALID_STATUSES.has(r.status)) return null
	if (r.kind !== "cangjie-test") return null

	if (typeof r.createdAt !== "number" || !Number.isFinite(r.createdAt) || r.createdAt < 0) return null

	if (r.contentSha256 !== undefined) {
		if (typeof r.contentSha256 !== "string" || !SHA256_HEX_PATTERN.test(r.contentSha256)) {
			return null
		}
	}

	return {
		taskId: r.taskId,
		status: r.status as FileStatus,
		workspaceRoot: r.workspaceRoot,
		absolutePath: path.normalize(r.absolutePath),
		contentSha256: r.contentSha256 as string | undefined,
		createdAt: r.createdAt,
		kind: "cangjie-test",
	}
}

function isLegacyFormat(raw: unknown): raw is Record<string, string[]> {
	if (typeof raw !== "object" || raw === null) return false
	for (const v of Object.values(raw)) {
		if (!Array.isArray(v)) return false
		if (v.length > 0 && typeof v[0] === "object") return false
	}
	return true
}

function migrateFromLegacy(raw: Record<string, string[]>): Record<string, GeneratedFileRecord[]> {
	const result: Record<string, GeneratedFileRecord[]> = {}
	for (const [taskId, paths] of Object.entries(raw)) {
		if (!Array.isArray(paths)) continue
		result[taskId] = paths
			.filter((p): p is string => typeof p === "string")
			.map((p) => ({
				taskId,
				status: "legacy" as FileStatus,
				workspaceRoot: "",
				absolutePath: path.normalize(p),
				createdAt: 0,
				kind: "cangjie-test" as const,
			}))
	}
	return result
}

export function initTestCleanup(memento: Memento): void {
	workspaceState = memento
	byTaskId.clear()
	const saved = memento.get<unknown>(WORKSPACE_STATE_KEY, {})

	let records: Record<string, unknown[]>
	if (isLegacyFormat(saved)) {
		records = migrateFromLegacy(saved)
	} else if (typeof saved === "object" && saved !== null) {
		records = saved as Record<string, unknown[]>
	} else {
		records = {}
	}

	for (const [taskId, recs] of Object.entries(records)) {
		if (!Array.isArray(recs)) continue
		const inner = new Map<string, GeneratedFileRecord>()
		for (const rec of recs) {
			const validated = validateRecord(rec, taskId)
			if (!validated) {
				logger.warn("CangjieTestCleanup", `拒绝加载无效记录 (taskId=${taskId})`)
				continue
			}
			inner.set(validated.absolutePath, validated)
		}
		if (inner.size > 0) {
			byTaskId.set(taskId, inner)
		}
	}
}

function persistToState(): void {
	if (!workspaceState) return
	const obj: Record<string, GeneratedFileRecord[]> = {}
	for (const [k, inner] of byTaskId) {
		obj[k] = [...inner.values()].filter((r) => r.status !== "deleted")
	}
	void workspaceState.update(WORKSPACE_STATE_KEY, obj)
}

async function computeFileHashAsync(filePath: string): Promise<string | undefined> {
	try {
		const content = await fsp.readFile(filePath)
		return crypto.createHash("sha256").update(content).digest("hex")
	} catch {
		return undefined
	}
}

export async function registerGeneratedCangjieTestFile(
	taskId: string | undefined,
	absPath: string,
	workspaceRoot?: string,
): Promise<void> {
	const key = taskId ?? NO_TASK_KEY
	const norm = path.normalize(absPath)
	const hash = await computeFileHashAsync(absPath)

	let inner = byTaskId.get(key)
	if (!inner) {
		inner = new Map()
		byTaskId.set(key, inner)
	}

	inner.set(norm, {
		taskId: key,
		status: hash ? "active" : "detached",
		workspaceRoot: workspaceRoot ?? "",
		absolutePath: norm,
		contentSha256: hash,
		createdAt: Date.now(),
		kind: "cangjie-test",
	})
	persistToState()
}

export function transitionTaskFilesToDetached(taskId: string): number {
	const inner = byTaskId.get(taskId)
	if (!inner) return 0
	let transitioned = 0
	for (const rec of inner.values()) {
		if (rec.status === "active") {
			rec.status = "detached"
			transitioned++
		}
	}
	if (transitioned > 0) {
		persistToState()
	}
	return transitioned
}

export function transitionStaleRegistrationsToDetached(
	shouldRetainTaskId: (id: string) => boolean,
): { taskEntriesTransitioned: number } {
	let taskEntriesTransitioned = 0
	for (const id of [...byTaskId.keys()]) {
		if (shouldRetainTaskId(id)) continue
		const inner = byTaskId.get(id)
		if (!inner) continue
		let changed = false
		for (const rec of inner.values()) {
			if (rec.status === "active") {
				rec.status = "detached"
				changed = true
			}
		}
		if (changed) {
			taskEntriesTransitioned++
		}
	}
	if (taskEntriesTransitioned > 0) {
		persistToState()
	}
	return { taskEntriesTransitioned }
}

export function scanGeneratedFilesForCleanup(): ScanResult {
	const result: ScanResult = { active: [], detached: [], legacy: [] }
	for (const inner of byTaskId.values()) {
		for (const rec of inner.values()) {
			if (rec.status === "deleted") continue
			if (rec.status === "active") {
				result.active.push(rec)
			} else if (rec.status === "detached") {
				result.detached.push(rec)
			} else if (rec.status === "legacy") {
				result.legacy.push(rec)
			}
		}
	}
	return result
}

/**
 * Re-associate legacy files with workspace roots.
 *
 * Legacy files migrated from the old string[] format have empty `workspaceRoot`.
 * This function scans all legacy records and checks if their canonical path
 * falls within any of the provided workspace roots. If yes, the record's
 * `workspaceRoot` is updated. Non-workspace legacy files are left unchanged
 * and will be permanently skipped during deletion.
 */
export function reassociateLegacyFiles(workspaceRoots: string[]): ReassociateResult {
	const normalizedRoots = workspaceRoots
		.filter((r) => r.length > 0)
		.map((r) => path.normalize(r))

	let reassociated = 0
	let outsideWorkspace = 0

	for (const inner of byTaskId.values()) {
		for (const rec of inner.values()) {
			if (rec.status !== "legacy") continue

			const normalizedPath = path.normalize(rec.absolutePath)
			let matched = false

			for (const root of normalizedRoots) {
				const rel = path.relative(root, normalizedPath)
				if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
					rec.workspaceRoot = root
					reassociated++
					matched = true
					break
				}
			}

			if (!matched) {
				outsideWorkspace++
			}
		}
	}

	if (reassociated > 0) {
		persistToState()
	}

	return { reassociated, outsideWorkspace }
}

async function isWithinWorkspace(filePath: string, workspaceRoot: string): Promise<boolean> {
	if (!workspaceRoot) return false
	try {
		const real = await fsp.realpath(filePath)
		const root = await fsp.realpath(workspaceRoot)
		const rel = path.relative(root, real)
		return !rel.startsWith("..") && !path.isAbsolute(rel)
	} catch {
		return false
	}
}

function isSafeRegularFile(stat: fs.Stats): boolean {
	if (stat.isSymbolicLink()) return false
	if (stat.isFIFO()) return false
	if (stat.isSocket()) return false
	if (stat.isBlockDevice()) return false
	if (stat.isCharacterDevice()) return false
	return stat.isFile()
}

export async function deleteConfirmedCangjieTestFiles(
	records: GeneratedFileRecord[],
	options: { allowLegacy?: boolean } = {},
): Promise<CleanupResult> {
	const result: CleanupResult = {
		deleted: [],
		skippedModified: [],
		skippedOutsideWorkspace: [],
		skippedLegacyNotConfirmed: [],
		skippedInvalid: [],
		failed: [],
	}

	for (const rec of records) {
		const p = rec.absolutePath
		try {
			const base = path.basename(p)
			if (!base.endsWith("_test.cj")) {
				result.skippedModified.push(p)
				continue
			}

			if (rec.status === "legacy" && !options.allowLegacy) {
				result.skippedLegacyNotConfirmed.push(p)
				continue
			}

			if (!rec.workspaceRoot) {
				logSecurityEvent({
					action: "cangjie.test_file.delete",
					resource: p,
					result: "denied",
					reason: rec.status === "legacy"
						? "legacy_outside_workspace_permanently_skipped"
						: "empty_workspace_root_fail_closed",
				})
				result.skippedOutsideWorkspace.push(p)
				continue
			}

			let lstat: fs.Stats
			try {
				lstat = await fsp.lstat(p)
			} catch {
				result.skippedInvalid.push(p)
				continue
			}

			if (!isSafeRegularFile(lstat)) {
				logSecurityEvent({
					action: "cangjie.test_file.delete",
					resource: p,
					result: "denied",
					reason: "not_safe_regular_file",
				})
				result.skippedModified.push(p)
				continue
			}

			const within = await isWithinWorkspace(p, rec.workspaceRoot)
			if (!within) {
				logSecurityEvent({
					action: "cangjie.test_file.delete",
					resource: p,
					result: "denied",
					reason: "outside_workspace",
				})
				result.skippedOutsideWorkspace.push(p)
				continue
			}

			if (rec.contentSha256) {
				const currentHash = await computeFileHashAsync(p)
				if (!currentHash || currentHash !== rec.contentSha256) {
					logSecurityEvent({
						action: "cangjie.test_file.delete",
						resource: p,
						result: "denied",
						reason: "hash_mismatch_file_modified",
					})
					result.skippedModified.push(p)
					continue
				}
			} else if (rec.status !== "legacy" || !options.allowLegacy) {
				// Non-legacy files without hash are not deletable.
				// Legacy files with allowLegacy are allowed to skip hash check
				// (they were created before hash tracking was introduced).
				logSecurityEvent({
					action: "cangjie.test_file.delete",
					resource: p,
					result: "denied",
					reason: "missing_hash_not_deletable",
				})
				result.skippedInvalid.push(p)
				continue
			} else {
				// Legacy file with allowLegacy and no hash — log warning but proceed
				logSecurityEvent({
					action: "cangjie.test_file.delete",
					resource: p,
					result: "allowed",
					reason: "legacy_no_hash_user_confirmed",
				})
			}

			await fsp.unlink(p)
			result.deleted.push(p)
			logSecurityEvent({
				action: "cangjie.test_file.delete",
				resource: p,
				result: "allowed",
				reason: "user_confirmed",
			})

			const inner = byTaskId.get(rec.taskId)
			if (inner) {
				const existing = inner.get(path.normalize(p))
				if (existing) {
					existing.status = "deleted"
				}
				if (inner.size === 0 || [...inner.values()].every((r) => r.status === "deleted")) {
					byTaskId.delete(rec.taskId)
				}
			}
			persistToState()
		} catch (e) {
			result.failed.push({ path: p, error: e instanceof Error ? e.message : String(e) })
			logSecurityEvent({
				action: "cangjie.test_file.delete",
				resource: p,
				result: "failed",
				reason: e instanceof Error ? e.message : String(e),
			})
			logger.warn("CangjieTestCleanup", `删除失败 ${p}:`, e)
			TelemetryService.reportError(e, TelemetryEventName.CANGJIE_LSP_ERROR)
		}
	}

	return result
}

export function getRecordsForTask(taskId: string): GeneratedFileRecord[] {
	const inner = byTaskId.get(taskId)
	if (!inner) return []
	return [...inner.values()]
}

export function clearAllRegistrations(): void {
	byTaskId.clear()
	if (workspaceState) {
		void workspaceState.update(WORKSPACE_STATE_KEY, {})
	}
}
