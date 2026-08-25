import type { TSchema, TSchemaOptions, TUnion } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

export function Union<T extends TSchema[]>(
	schemas: [...T],
	options?: TSchemaOptions
): TUnion<T> {
	if (!options || isEmpty(options))
		return Object.defineProperty(
			{
				'~kind': 'Union',
				anyOf: schemas
			},
			'~kind',
			noEnumerable
		) as any

	const schema = { ...options, '~kind': 'Union', anyOf: schemas }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
