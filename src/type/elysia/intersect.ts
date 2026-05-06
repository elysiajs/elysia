import { isEmpty } from '../../utils'
import type { TIntersect, TSchema, TSchemaOptions } from 'typebox'

const noEnumerable = {
	enumerable: false
} as const

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

	options['~kind'] = 'Intersect'
	options.allOf = schemas
	return Object.defineProperty(options, '~kind', noEnumerable) as any
}
