import { type BaseSchema, type AnySchema } from '.'

import { primitiveElysiaTypes, type ELYSIA_TYPES } from './constants'

const iterators = ['anyOf', 'oneOf', 'allOf'] as const

export function hasType(
	type: string | ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: BaseSchema
): boolean {
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

	for (const key of iterators)
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

export function hasTypes(
	types: (string | ELYSIA_TYPES[keyof ELYSIA_TYPES])[],
	schema: AnySchema
) {
	if ('~standard' in schema) return false

	return _hasTypes(new Set(types), schema as BaseSchema)
}

function _hasTypes(
	types: Set<string | ELYSIA_TYPES[keyof ELYSIA_TYPES]>,
	schema: BaseSchema
): boolean {
	if (!schema) return false

	if (
		types.has(schema['~kind']) ||
		('~elyTyp' in schema && types.has(schema['~elyTyp']!))
	)
		return true

	if (
		typeof schema !== 'object' ||
		('~elyTyp' in schema &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (schema['~kind'] === 'Cyclic')
		if (schema.$defs![schema.$ref as keyof typeof schema.$defs])
			return _hasTypes(
				types,
				schema.$defs![schema.$ref as keyof typeof schema.$defs]
			)

	for (const key of iterators)
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

export function hasProperty(
	key: string | ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: BaseSchema
): boolean {
	if (!schema) return false

	if (key in schema) return true

	if (
		typeof schema !== 'object' ||
		('~elyTyp' in schema &&
			primitiveElysiaTypes.has(schema['~elyTyp'] as any))
	)
		return false

	if (
		schema['~kind'] === 'Cyclic' &&
		schema.$defs?.[schema.$ref as keyof typeof schema.$defs]
	)
		return hasProperty(
			key,
			schema.$defs[schema.$ref as keyof typeof schema.$defs] as any
		)

	for (const k of iterators)
		if (schema[k]?.some((s: BaseSchema) => hasProperty(key, s))) return true

	if (schema.not && hasProperty(key, schema.not)) return true

	if (schema.items)
		return Array.isArray(schema.items)
			? schema.items.some((s) => hasProperty(key, s))
			: hasProperty(key, schema.items)

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (hasProperty(key, v)) return true

	if (
		typeof schema.additionalProperties === 'object' &&
		hasProperty(key, schema.additionalProperties)
	)
		return true

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (hasProperty(key, v)) return true

	return false
}

/**
 * Utility function to inherit add custom error and keep the original Validation error
 *
 * @since 1.3.14
 *
 * @example
 * ```ts
 * import { Elysia, t, errorWithDetail } from 'elysia'
 *
 * new Elysia()
 *		.post('/', () => 'Hello World!', {
 *			body: t.Object({
 *				x: t.Number({
 *					error: validationDetail('x must be a number')
 *				})
 *			})
 *		})
 */
// export const validationDetail =
// 	<T>(message: T) =>
// 	(error: Parameters<ElysiaTypeCustomErrorCallback>[0]) => ({
// 		...error,
// 		message
// 	})
