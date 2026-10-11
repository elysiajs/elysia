import { Null, Undefined } from '../typebox-type'
import type { TSchema, TSchemaOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Union } from './union'
import { elyType } from './utils'

export function MaybeEmpty<T extends TSchema>(
	schema: T,
	options?: TSchemaOptions
) {
	return elyType(
		ELYSIA_TYPES.MaybeEmpty,
		Union([schema, Null(), Undefined()], { ...options, nullable: true })
	)
}
