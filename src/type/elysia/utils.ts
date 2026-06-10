import { Type } from 'typebox'
import type { Static, TSchema } from 'typebox'

import { fnv1a } from '../../utils'
import type { BaseSchema } from '../types'
import type { ELYSIA_TYPES } from '../constants'

export function cloneSchema<T extends TSchema>(schema: T): T {
	const target = { ...schema } as T
	for (const key of Object.getOwnPropertyNames(schema)) {
		const desc = Object.getOwnPropertyDescriptor(schema, key)
		if (!desc || desc.enumerable) continue
		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}
	return target
}

export function elyType<T extends TSchema>(
	name: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: T
): T {
	const elyDesc = Object.getOwnPropertyDescriptor(schema, '~elyTyp')
	if (
		Object.isExtensible(schema) &&
		(!elyDesc || elyDesc.writable !== false)
	) {
		// @ts-expect-error
		schema['~elyTyp'] = name
		return schema
	}

	const target = { ...schema, '~elyTyp': name } as T
	for (const key of Object.getOwnPropertyNames(schema)) {
		const desc = Object.getOwnPropertyDescriptor(schema, key)
		if (!desc || desc.enumerable || key === '~elyTyp') continue
		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}

	return target
}

export function assignOrNew<
	T extends Record<keyof any, unknown> | undefined,
	R extends Record<keyof any, unknown>
>(target: T, source: R): undefined extends T ? R : T & R {
	if (target) return Object.assign(target, source)

	return source as unknown as T & R
}

export function createSharedReference<
	const P extends Record<keyof any, unknown>,
	const T extends TSchema
>(createType: (property: P) => T) {
	const shared = Object.create(null)

	return (property: P): T => {
		const hash = propertyChecksum(property)
		if (hash[0] in shared) {
			const cached = shared[hash[0]]

			if (hash[1])
				return Object.defineProperty(
					Object.assign(hash[1], cached as Record<string, unknown>),
					'~kind',
					{ value: cached['~kind'], enumerable: false }
				) as T

			return cached
		}

		return (shared[hash[0]] = Object.freeze(createType(property)))
	}
}

export const hasMeta = (
	property: Partial<BaseSchema> & Record<keyof any, unknown>
) =>
	'title' in property ||
	'description' in property ||
	'tags' in property ||
	'examples' in property ||
	'error' in property ||
	'default' in property

export function getMeta(
	property: Partial<BaseSchema> & Record<keyof any, unknown>,
	doHaveMeta = hasMeta(property)
) {
	if (doHaveMeta) {
		const {
			title,
			description,
			tags,
			examples,
			error,
			default: defaultValue,
			...rest
		} = property

		const meta: Record<string, unknown> = {}
		if (title !== undefined) meta['title'] = title
		if (description !== undefined) meta['description'] = description
		if (tags !== undefined) meta['tags'] = tags
		if (examples !== undefined) meta['examples'] = examples
		if (error !== undefined) meta['error'] = error
		if (defaultValue !== undefined) meta['default'] = defaultValue

		return [rest, meta] as const
	}

	return [property] as const
}

export function propertyChecksum(
	property: Partial<BaseSchema> & Record<keyof any, unknown>
) {
	if (hasMeta(property)) {
		const [constraints, meta] = getMeta(property, true)
		const entries = Object.entries(constraints)

		switch (entries.length) {
			case 0:
				return [0, meta] as const

			case 1:
				return [fnv1a(entries[0].toString()), meta] as const

			default:
				return [fnv1a(entries.toSorted().toString()), meta] as const
		}
	}

	const entries = Object.entries(property)
	if (!entries.length) return [0] as const

	return [fnv1a(JSON.stringify(entries))] as const
}

export type Refines<T> = [refine: (value: T) => boolean, message: string][]
export function Refines<T extends TSchema>(
	schema: T,
	refines: Refines<Static<T>>
) {
	for (const [refine, message] of refines)
		schema = Type.Refine(schema, refine, message)

	return schema
}
