import { Refine } from '../typebox-type'
import type { Static, TSchema } from 'typebox'

import { fnv1a, evictOldestHalf } from '../../utils'
import type { BaseSchema } from '../types'
import type { ELYSIA_TYPES } from '../constants'
import {
	copyNonEnumerable,
	referenceCache,
	SHARED_REFERENCE_CACHE_LIMIT
} from '../shared'

export function cloneSchema<T extends TSchema>(schema: T): T {
	const target = { ...schema } as T
	copyNonEnumerable(schema, target)
	return target
}

// `schema`, or a clone of it carrying `property`'s meta (title, default, ...)
export function withMeta<T extends TSchema>(schema: T, property: object): T {
	const [, meta] = getMeta(property as any)

	return meta ? Object.assign(cloneSchema(schema), meta) : schema
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

export function createSharedReference<
	const P extends Record<keyof any, unknown>,
	const T extends TSchema
>(createType: (property: P) => T) {
	const shared = new Map<number, { key: string; schema: T }>()
	referenceCache(shared)

	return (property: P): T => {
		// meta (title, default, error, ...) is per-site, never shared
		if (hasMeta(property)) return createType(property)

		const h = propertyChecksum(property)
		const serialized = JSON.stringify(property)
		const bucket = shared.get(h)

		if (bucket?.key === serialized) {
			// LRU-touch only at cap: per-hit delete+set permanently grows the
			// JSC heap (bucket churn survives gc/clear)
			if (shared.size >= SHARED_REFERENCE_CACHE_LIMIT) {
				shared.delete(h)
				shared.set(h, bucket)
			}

			return bucket.schema
		}

		const schema = Object.freeze(createType(property))

		// hash-collision replace overwrites in place, no delete needed
		if (!bucket && shared.size >= SHARED_REFERENCE_CACHE_LIMIT)
			evictOldestHalf(shared)
		shared.set(h, { key: serialized, schema })

		return schema
	}
}

const hasMeta = (property: Partial<BaseSchema> & Record<keyof any, unknown>) =>
	'title' in property ||
	'description' in property ||
	'tags' in property ||
	'examples' in property ||
	'error' in property ||
	'default' in property

export function getMeta(
	property: Partial<BaseSchema> & Record<keyof any, unknown>
) {
	if (hasMeta(property)) {
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

export const propertyChecksum = (property: object) =>
	fnv1a(JSON.stringify(Object.entries(property)))

export type Refines<T> = [refine: (value: T) => boolean, message: string][]
export function Refines<T extends TSchema>(
	schema: T,
	refines: Refines<Static<T>>
) {
	for (const [refine, message] of refines)
		schema = Refine(schema, refine, () => message)

	return schema
}
