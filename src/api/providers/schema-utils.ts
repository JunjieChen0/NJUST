/**
 * Shared schema processing utilities for OpenAI-compatible providers.
 * Used by openai-codex and openai-native to normalize JSON schemas.
 */

type JsonSchema = Record<string, unknown> & {
	type?: string | string[]
	required?: string[]
	additionalProperties?: boolean
	properties?: Record<string, JsonSchema>
	items?: JsonSchema
}

function isSchema(value: unknown): value is JsonSchema {
	return typeof value === "object" && value !== null
}

export function ensureAllRequired(schema: JsonSchema): JsonSchema
export function ensureAllRequired(schema: undefined): undefined
export function ensureAllRequired(schema: JsonSchema | undefined): JsonSchema | undefined
export function ensureAllRequired(schema: JsonSchema | undefined): JsonSchema | undefined {
	const getPrimaryType = (value: unknown): string | undefined =>
		isSchema(value) ? (Array.isArray(value.type) ? value.type.find((t) => t !== "null") : value.type) : undefined

	if (!isSchema(schema) || getPrimaryType(schema) !== "object") {
		return schema
	}

	const result: JsonSchema = { ...schema }
	const originallyRequired = new Set(Array.isArray(schema.required) ? schema.required : [])
	if (result.additionalProperties !== false) {
		result.additionalProperties = false
	}

	if (result.properties) {
		const allKeys = Object.keys(result.properties)
		result.required = allKeys

		const newProps: Record<string, JsonSchema> = { ...result.properties }
		for (const key of allKeys) {
			const prop = newProps[key]
			if (prop && !originallyRequired.has(key)) {
				const types = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : []
				if (types.length > 0 && !types.includes("null")) {
					newProps[key] = { ...prop, type: [...types, "null"] }
				}
			}
			const normalizedProp = newProps[key]
			if (!normalizedProp) {
				continue
			}
			const primaryType = getPrimaryType(normalizedProp)
			if (primaryType === "object") {
				newProps[key] = ensureAllRequired(normalizedProp)
			} else if (primaryType === "array" && getPrimaryType(normalizedProp.items) === "object") {
				newProps[key] = {
					...normalizedProp,
					items: ensureAllRequired(normalizedProp.items),
				}
			}
		}
		result.properties = newProps
	}

	return result
}

export function ensureAdditionalPropertiesFalse(schema: JsonSchema): JsonSchema
export function ensureAdditionalPropertiesFalse(schema: undefined): undefined
export function ensureAdditionalPropertiesFalse(schema: JsonSchema | undefined): JsonSchema | undefined
export function ensureAdditionalPropertiesFalse(schema: JsonSchema | undefined): JsonSchema | undefined {
	if (!isSchema(schema) || schema.type !== "object") {
		return schema
	}

	const result: JsonSchema = { ...schema }
	if (result.additionalProperties !== false) {
		result.additionalProperties = false
	}

	if (result.properties) {
		const newProps: Record<string, JsonSchema> = { ...result.properties }
		for (const key of Object.keys(result.properties)) {
			const prop = newProps[key]
			if (prop && prop.type === "object") {
				newProps[key] = ensureAdditionalPropertiesFalse(prop)
			} else if (prop && prop.type === "array" && prop.items?.type === "object") {
				newProps[key] = {
					...prop,
					items: ensureAdditionalPropertiesFalse(prop.items),
				}
			}
		}
		result.properties = newProps
	}

	return result
}
