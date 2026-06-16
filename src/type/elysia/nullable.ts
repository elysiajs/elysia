import { Type } from 'typebox'
import type { TSchema, TSchemaOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Union } from './union'
import { assignOrNew, elyType } from './utils'

export const Nullable = <T extends TSchema>(
	schema: T,
	options?: TSchemaOptions
) =>
	elyType(
		ELYSIA_TYPES.Nullable,
		Union([schema, Type.Null()], assignOrNew(options, { nullable: true }))
	)
