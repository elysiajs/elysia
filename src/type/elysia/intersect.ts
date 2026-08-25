import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'
import type { TIntersect, TSchema, TSchemaOptions } from 'typebox'

export function Intersect<T extends TSchema[]>(
	schemas: [...T],
	options?: TSchemaOptions
): TIntersect<T> {
	if (!options || isEmpty(options))
		return Object.defineProperty(
			{
				'~kind': 'Intersect',
				allOf: schemas
			},
			'~kind',
			noEnumerable
		) as any

	const schema = { ...options, '~kind': 'Intersect', allOf: schemas }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
