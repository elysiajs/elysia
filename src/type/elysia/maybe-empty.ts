import { Null, Undefined } from 'typebox/type'
import type { TSchema, TSchemaOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Union } from './union'
import { assignOrNew, elyType } from './utils'

export function MaybeEmpty<T extends TSchema>(
	schema: T,
	options?: TSchemaOptions
) {
	if (options && !('nullable' in options)) options.nullable = true

	return elyType(
		ELYSIA_TYPES.MaybeEmpty,
		Union(
			[schema, Null(), Undefined()],
			assignOrNew(options, { nullable: true })
		)
	)
}
