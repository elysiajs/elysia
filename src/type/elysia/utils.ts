import { Refine } from 'typebox/type'
import type { Static, TSchema } from 'typebox'

import { fnv1a } from '../../utils'
import type { BaseSchema } from '../types'
import type { ELYSIA_TYPES } from '../constants'
import { referenceCache, SHARED_REFERENCE_CACHE_LIMIT } from '../shared'

export function copyNonEnumerable(
	src: object,
	target: object,
	skipKey?: string
) {
	for (const key of Object.getOwnPropertyNames(src)) {
		const desc = Object.getOwnPropertyDescriptor(src, key)
		if (!desc || desc.enumerable || key === skipKey) continue

		Object.defineProperty(target, key, {
			value: desc.value,
			enumerable: false,
			writable: true,
			configurable: true
		})
	}
}

export function cloneSchema<T extends TSchema>(schema: T): T {
	const target = { ...schema } as T
	copyNonEnumerable(schema, target)
	return target
}

export function elyType<T extends TSchema>(
	name: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	schema: T
): T {
	const target = Object.assign(
		Object.create(Object.getPrototypeOf(schema)),
		schema,
		{ '~elyTyp': name }
	) as T

	copyNonEnumerable(schema, target, '~elyTyp')

	return target
}

export { clearSharedReferenceCaches } from '../shared'

export function createSharedReference<
	const P extends Record<keyof any, unknown>,
	const T extends TSchema
>(createType: (property: P) => T) {
	const shared = new Map<number, { key: string; schema: T }>()
	referenceCache(shared)

	return (property: P): T => {
		const hash = propertyChecksum(property)
		if (hash[1]) return createType(property)

		const h = hash[0]
		const canonicalKey = JSON.stringify(property)
		const bucket = shared.get(h)

		if (bucket?.key === canonicalKey) {
			// LRU-touch only at cap: per-hit delete+set permanently grows the
			// JSC heap (bucket churn survives gc/clear)
			if (shared.size >= SHARED_REFERENCE_CACHE_LIMIT) {
				shared.delete(h)
				shared.set(h, bucket)
			}

			return bucket.schema
		}

		const schema = Object.freeze(createType(property))
		if (bucket) shared.delete(h)
		else if (shared.size >= SHARED_REFERENCE_CACHE_LIMIT) {
			const oldest = shared.keys().next().value
			if (oldest !== undefined) shared.delete(oldest)
		}
		shared.set(h, { key: canonicalKey, schema })

		return schema
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
		schema = Refine(schema, refine, () => message)

	return schema
}
