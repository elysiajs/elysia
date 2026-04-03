import { ELYSIA_TYPES, type BaseSchema } from '../type-system'

const primitiveElysiaTypes = new Set([
	ELYSIA_TYPES.Numeric,
	ELYSIA_TYPES.Integer,
	ELYSIA_TYPES.BooleanString,
	ELYSIA_TYPES.Date,
	ELYSIA_TYPES.File,
	ELYSIA_TYPES.Files,
	ELYSIA_TYPES.ArrayBuffer,
	ELYSIA_TYPES.Uint8Array
])

export function hasType(type: string, schema: BaseSchema): boolean {
	if (
		!schema ||
		typeof schema !== 'object' ||
		(schema['~elyTyp'] &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (schema['~kind'] === type) return true

	if (
		schema['~kind'] === 'Cyclic' &&
		schema.$defs &&
		schema.$ref &&
		schema.$defs[schema.$ref]
	)
		return hasType(type, schema.$defs[schema.$ref])

	for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
		if (
			schema[key] &&
			schema[key].some((s: BaseSchema) => hasType(type, s))
		)
			return true

	if (schema.not && hasType(type, schema.not)) return true

	if (schema.items)
		return Array.isArray(schema.items)
			? schema.items.some((s) => hasType(type, s))
			: hasType(type, schema.items)

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (hasType(type, v)) return true

	// additionalProperties (when schema, not boolean)
	if (
		typeof schema.additionalProperties === 'object' &&
		hasType(type, schema.additionalProperties)
	)
		return true

	// Record (patternProperties)
	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (hasType(type, v)) return true

	return false
}

export const hasTypes = (types: string[], schema: BaseSchema) =>
	_hasTypes(new Set(types), schema)

function _hasTypes(types: Set<string>, schema: BaseSchema): boolean {
	if (
		!schema ||
		typeof schema !== 'object' ||
		(schema['~elyTyp'] &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (types.has(schema['~kind'])) return true

	if (schema['~kind'] === 'Cyclic' && schema.$defs && schema.$ref)
		if (schema.$defs[schema.$ref])
			return _hasTypes(types, schema.$defs[schema.$ref])

	for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
		if (
			schema[key] &&
			schema[key].some((s) => _hasTypes(types, s))
		)
			return true

	if (schema.not && _hasTypes(types, schema.not)) return true

	if (schema.items)
		return Array.isArray(schema.items)
			? schema.items.some((s) => _hasTypes(types, s))
			: _hasTypes(types, schema.items)

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (_hasTypes(types, v)) return true

	if (typeof schema.additionalProperties === 'object' && _hasTypes(types, v))
		return true

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (_hasTypes(types, v)) return true

	return false
}
