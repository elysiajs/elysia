import { primitiveElysiaTypes, ELYSIA_TYPES, type BaseSchema } from '../type'

export function hasType(
	type: string | ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: BaseSchema
): boolean {
	if (!schema) return false

	if (typeof type === 'string') {
		if (schema['~kind'] === type) return true
	} else {
		if (schema['~elyTyp'] === type) return true
	}

	if (
		typeof schema !== 'object' ||
		(schema['~elyTyp'] &&
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

function _hasTypes(
	types: Set<string | ELYSIA_TYPES[keyof ELYSIA_TYPES]>,
	schema: BaseSchema
): boolean {
	if (!schema) return false

	if (
		types.has(schema['~kind']) ||
		(schema['~elyTyp'] && types.has(schema['~elyTyp']))
	)
		return true

	if (
		typeof schema !== 'object' ||
		(schema['~elyTyp'] &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (schema['~kind'] === 'Cyclic')
		if (schema.$defs![schema.$ref as keyof typeof schema.$defs])
			return _hasTypes(
				types,
				schema.$defs![schema.$ref as keyof typeof schema.$defs]
			)

	for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
		if (schema[key] && schema[key].some((s) => _hasTypes(types, s)))
			return true

	if (schema.not && _hasTypes(types, schema.not)) return true

	if (schema.items)
		return Array.isArray(schema.items)
			? schema.items.some((s) => _hasTypes(types, s))
			: _hasTypes(types, schema.items)

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (_hasTypes(types, v)) return true

	if (
		typeof schema.additionalProperties === 'object' &&
		_hasTypes(types, schema.additionalProperties)
	)
		return true

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (_hasTypes(types, v)) return true

	return false
}
