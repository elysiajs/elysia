import type { TSchema, TSchemaOptions, TUnion } from 'typebox'

import { noEnumerable } from '../constants'

export function Union<T extends TSchema[]>(
	schemas: [...T],
	options?: TSchemaOptions
): TUnion<T> {
	const schema = { ...options, '~kind': 'Union', anyOf: schemas }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
