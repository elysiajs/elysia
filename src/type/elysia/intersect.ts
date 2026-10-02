import { noEnumerable } from '../constants'
import type { TIntersect, TSchema, TSchemaOptions } from 'typebox'

export function Intersect<T extends TSchema[]>(
	schemas: [...T],
	options?: TSchemaOptions
): TIntersect<T> {
	const schema = { ...options, '~kind': 'Intersect', allOf: schemas }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
