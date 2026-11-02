/**
 * Docker Policy Proxy — request body allowlist
 *
 * Docker decodes JSON with Go's encoding/json, which matches field names
 * case-insensitively and acts on every field it knows. So the proxy must not
 * forward anything it has not checked: each body is rebuilt from allowlisted
 * fields only. A field outside the allowlist is dropped when it holds a zero
 * value (the Docker CLI sends many such defaults, and Go treats them as unset)
 * and rejected otherwise.
 */

import type { DockerCreateContainerRequest, DockerKillContainerRequest } from "./types"

type FieldType = "string" | "boolean" | "number" | "string[]" | "number[]" | "array" | "object"

/** `value: undefined` means the field is valid but not forwarded. */
type Result = { value: unknown } | { error: string }

/** A field's expected type, or a function that checks and rebuilds a nested value. */
type Rule = FieldType | ((value: unknown, where: string) => Result)

// Go also folds a few non-ASCII letters onto ASCII ones ("ſ" → "s", "K" → "k").
// No Docker field name needs them, so non-ASCII names are rejected outright.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * null, false, 0, "", {}, or an array of such values. A non-empty object is never
 * zero: it may be a map such as Volumes {"/data": {}} whose keys are the content.
 */
function isZeroValue(value: unknown): boolean {
	if (value === null || value === undefined || value === false || value === 0 || value === "") return true
	if (Array.isArray(value)) return value.every(isZeroValue)
	if (isPlainObject(value)) return Object.keys(value).length === 0
	return false
}

function matchesType(value: unknown, type: FieldType): boolean {
	switch (type) {
		case "string":
		case "boolean":
		case "number":
			return typeof value === type
		case "string[]":
			return Array.isArray(value) && value.every((item) => typeof item === "string")
		case "number[]":
			return Array.isArray(value) && value.every((item) => typeof item === "number")
		case "array":
			return Array.isArray(value)
		case "object":
			return isPlainObject(value)
	}
}

/**
 * Rebuild one object level from its allowlisted fields. Names must be ASCII, no
 * two may differ only in case, and an allowlisted field must use its exact
 * spelling. null values are dropped (Go decodes them as unset).
 */
function pickFields(value: unknown, rules: Record<string, Rule>, where: string): Result {
	if (!isPlainObject(value)) return { error: `${where} must be a JSON object` }

	const canonicalByFolded = new Map(Object.keys(rules).map((name) => [name.toLowerCase(), name]))
	const seen = new Map<string, string>()
	const picked: Record<string, unknown> = {}

	for (const [key, fieldValue] of Object.entries(value)) {
		if (!PRINTABLE_ASCII.test(key)) {
			return { error: `${where}: field name '${key}' must be ASCII` }
		}
		const folded = key.toLowerCase()
		const previous = seen.get(folded)
		if (previous !== undefined) {
			return { error: `${where}: fields '${previous}' and '${key}' differ only in case` }
		}
		seen.set(folded, key)

		const canonical = canonicalByFolded.get(folded)
		if (canonical === undefined) {
			if (isZeroValue(fieldValue)) continue
			return { error: `${where}.${key} is not allowed` }
		}
		if (canonical !== key) {
			return { error: `${where}: field '${key}' must be spelled '${canonical}'` }
		}
		if (fieldValue === null) continue

		const rule = rules[canonical]!
		if (typeof rule === "function") {
			const nested = rule(fieldValue, `${where}.${canonical}`)
			if ("error" in nested) return nested
			if (nested.value !== undefined) picked[canonical] = nested.value
		} else if (matchesType(fieldValue, rule)) {
			picked[canonical] = fieldValue
		} else {
			return { error: `${where}.${canonical} must be ${rule}` }
		}
	}
	return { value: picked }
}

const MOUNT_RULES: Record<string, Rule> = {
	Type: "string",
	Source: "string",
	Target: "string",
	ReadOnly: "boolean",
}

function pickMounts(value: unknown, where: string): Result {
	if (!Array.isArray(value)) return { error: `${where} must be an array` }
	const mounts: unknown[] = []
	for (const [index, mount] of value.entries()) {
		const picked = pickFields(mount, MOUNT_RULES, `${where}[${index}]`)
		if ("error" in picked) return picked
		mounts.push(picked.value)
	}
	return { value: mounts }
}

/** `docker run` always sends RestartPolicy; only "no restart" is allowed. */
function pickRestartPolicy(value: unknown, where: string): Result {
	const picked = pickFields(value, { Name: "string", MaximumRetryCount: "number" }, where)
	if ("error" in picked) return picked
	const policy = picked.value as { Name?: string; MaximumRetryCount?: number }
	if ((policy.Name ?? "") !== "" && policy.Name !== "no") {
		return { error: `${where}.Name '${policy.Name}' is not allowed` }
	}
	if ((policy.MaximumRetryCount ?? 0) !== 0) {
		return { error: `${where}.MaximumRetryCount must be 0` }
	}
	return picked
}

/** `docker run` always sends LogConfig; only the daemon default (empty) is allowed. */
function pickLogConfig(value: unknown, where: string): Result {
	const picked = pickFields(value, { Type: "string", Config: "object" }, where)
	if ("error" in picked) return picked
	const logConfig = picked.value as { Type?: string; Config?: Record<string, unknown> }
	if ((logConfig.Type ?? "") !== "" || Object.keys(logConfig.Config ?? {}).length > 0) {
		return { error: `${where} must be empty (use the daemon default)` }
	}
	return { value: {} }
}

/**
 * The Docker CLI sends MemorySwappiness: -1 by default, which means "use the system
 * default" — the same as not sending it — so it is accepted and not forwarded.
 */
function pickMemorySwappiness(value: unknown, where: string): Result {
	return value === -1 ? { value: undefined } : { error: `${where} is not allowed (only the default -1)` }
}

const HOST_CONFIG_RULES: Record<string, Rule> = {
	Binds: "string[]",
	Mounts: pickMounts,
	NetworkMode: "string",
	Privileged: "boolean",
	PidMode: "string",
	IpcMode: "string",
	UsernsMode: "string",
	CapAdd: "string[]",
	CapDrop: "string[]",
	CpuShares: "number",
	Memory: "number",
	MemorySwap: "number",
	NanoCpus: "number",
	PidsLimit: "number",
	SecurityOpt: "string[]",
	Devices: "array",
	VolumesFrom: "string[]",
	AutoRemove: "boolean",
	RestartPolicy: pickRestartPolicy,
	LogConfig: pickLogConfig,
	MemorySwappiness: pickMemorySwappiness,
	ConsoleSize: "number[]",
}

/** Endpoints may only join allowed networks, with optional aliases and no other settings. */
function networkingConfigRule(allowedNetworks: readonly string[]): Rule {
	const pickEndpoints = (value: unknown, where: string): Result => {
		if (!isPlainObject(value)) return { error: `${where} must be a JSON object` }
		const endpoints: Record<string, unknown> = {}
		for (const [network, settings] of Object.entries(value)) {
			if (!allowedNetworks.includes(network)) {
				return { error: `${where}: network '${network}' is not allowed` }
			}
			const picked = pickFields(settings ?? {}, { Aliases: "string[]" }, `${where}.${network}`)
			if ("error" in picked) return picked
			endpoints[network] = picked.value
		}
		return { value: endpoints }
	}
	return (value, where) => pickFields(value, { EndpointsConfig: pickEndpoints }, where)
}

function createRules(allowedNetworks: readonly string[]): Record<string, Rule> {
	return {
		Image: "string",
		Name: "string",
		Env: "string[]",
		Cmd: "string[]",
		Entrypoint: "string[]",
		WorkingDir: "string",
		User: "string",
		Hostname: "string",
		Domainname: "string",
		Labels: "object",
		AttachStdin: "boolean",
		AttachStdout: "boolean",
		AttachStderr: "boolean",
		Tty: "boolean",
		OpenStdin: "boolean",
		StdinOnce: "boolean",
		HostConfig: (value, where) => pickFields(value, HOST_CONFIG_RULES, where),
		NetworkingConfig: networkingConfigRule(allowedNetworks),
	}
}

/**
 * Check a POST /containers/create body and rebuild it from allowlisted fields.
 * Returns the rebuilt body (the only thing that may be forwarded) or a reason.
 */
export function sanitizeCreateContainerBody(
	body: unknown,
	allowedNetworks: readonly string[],
): { body: DockerCreateContainerRequest } | { error: string } {
	if (!isPlainObject(body)) return { error: "Request body must be a JSON object" }
	const picked = pickFields(body, createRules(allowedNetworks), "body")
	if ("error" in picked) return picked

	const labels = (picked.value as Record<string, unknown>).Labels
	if (isPlainObject(labels) && !Object.values(labels).every((label) => typeof label === "string")) {
		return { error: "body.Labels values must be strings" }
	}
	return { body: picked.value as DockerCreateContainerRequest }
}

/** Check a POST /containers/{id}/kill body and rebuild it from allowlisted fields. */
export function sanitizeKillContainerBody(body: unknown): { body: DockerKillContainerRequest } | { error: string } {
	if (!isPlainObject(body)) return { error: "Request body must be a JSON object" }
	const picked = pickFields(body, { Signal: "string" }, "body")
	return "error" in picked ? picked : { body: picked.value as DockerKillContainerRequest }
}
