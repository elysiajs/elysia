import type { TSchema } from 'typebox'
import type { BaseSchema } from '../../src/type'

import { ELYSIA_TYPES, primitiveElysiaTypes } from '../../src/type/constants'

const iterators = ['anyOf', 'oneOf', 'allOf'] as const

// Moved here from src/type/utils.ts: `hasType` (singular) has no production
// callers — only these tests. Production uses `hasTypes` (plural). Kept verbatim
// as the unit under test; `hasType(t, s)` === `hasTypes([t], s)` for a single
// type, modulo `_hasTypes`' dual `~kind`/`~elyTyp` check.
export function hasType(
	type: string | ELYSIA_TYPES[keyof ELYSIA_TYPES],
	rawSchema: BaseSchema | TSchema
): boolean {
	const schema = rawSchema as BaseSchema

	if (!schema) return false

	if (schema[typeof type === 'string' ? '~kind' : '~elyTyp'] === type)
		return true

	if (
		typeof schema !== 'object' ||
		('~elyTyp' in schema &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (
		schema['~kind'] === 'Cyclic' &&
		schema.$defs![schema.$ref as keyof typeof schema.$defs]
	)
		return hasType(
			type,
			schema.$defs![schema.$ref as keyof typeof schema.$defs]
		)

	if (
		schema.$ref &&
		schema.$defs &&
		schema.$defs[schema.$ref as keyof typeof schema.$defs]
	)
		return hasType(
			type,
			schema.$defs[schema.$ref as keyof typeof schema.$defs] as BaseSchema
		)

	for (const key of iterators)
		if (
			schema[key] &&
			schema[key].some((s: BaseSchema) => hasType(type, s))
		)
			return true

	if (schema.not && hasType(type, schema.not)) return true

	if (schema.items) {
		if (Array.isArray(schema.items))
			return schema.items.some((s) => hasType(type, s))

		if (
			type === ELYSIA_TYPES.Files &&
			(schema.items as BaseSchema)['~elyTyp'] === ELYSIA_TYPES.File
		)
			return true

		return hasType(type, schema.items)
	}

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (hasType(type, v)) return true

	if (
		typeof schema.additionalProperties === 'object' &&
		hasType(type, schema.additionalProperties)
	)
		return true

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (hasType(type, v)) return true

	return false
}
