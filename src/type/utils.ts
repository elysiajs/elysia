import { type BaseSchema, type AnySchema } from '.'

import { ELYSIA_TYPES, primitiveElysiaTypes } from './constants'
import { schemaSome } from './validator/clean-safe'

const prunePrimitive = (node: any) =>
	'~elyTyp' in node && primitiveElysiaTypes.has(node['~elyTyp'])

const refTarget = (node: any) =>
	node.$ref && node.$defs
		? node.$defs[node.$ref as keyof typeof node.$defs]
		: undefined

export function hasTypes(
	types: (string | ELYSIA_TYPES[keyof ELYSIA_TYPES])[],
	schema: AnySchema
) {
	if ('~standard' in schema) return false

	const set = new Set<unknown>(types)
	const seen = new WeakSet<object>()
	const wantsFiles = set.has(ELYSIA_TYPES.Files)

	const test = (node: any) => {
		if (
			(node['~kind'] !== undefined && set.has(node['~kind'])) ||
			('~elyTyp' in node && set.has(node['~elyTyp']))
		)
			return true

		// t.Files carries File-typed items
		if (
			wantsFiles &&
			node.items &&
			!Array.isArray(node.items) &&
			node.items['~elyTyp'] === ELYSIA_TYPES.File
		)
			return true

		const target = refTarget(node)
		return target ? schemaSome(target, test, seen, prunePrimitive) : false
	}

	return schemaSome(schema, test, seen, prunePrimitive)
}

export function hasProperty(
	key: string | ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: BaseSchema
) {
	if (!schema) return false

	const seen = new WeakSet<object>()

	const test = (node: any) => {
		if (key in node) return true

		const target = refTarget(node)
		return target ? schemaSome(target, test, seen, prunePrimitive) : false
	}

	return schemaSome(schema, test, seen, prunePrimitive)
}
