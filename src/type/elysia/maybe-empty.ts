import { Null, Undefined } from '../typebox-type'
import type {
	TNull,
	TOptional,
	TSchema,
	TSchemaOptions,
	TUndefined,
	TUnion
} from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { optionalTrue } from './optional'
import { Union } from './union'
import { elyType } from './utils'

export type TMaybeEmpty<T extends TSchema> = TOptional<
	TUnion<[T, TNull, TUndefined]>
> & { '~elyTyp': ELYSIA_TYPES['MaybeEmpty'] }

export function MaybeEmpty<T extends TSchema>(
	schema: T,
	options?: TSchemaOptions
): TMaybeEmpty<T> {
	return Object.defineProperty(
		elyType(
			ELYSIA_TYPES.MaybeEmpty,
			Union([schema, Null(), Undefined()], { ...options, nullable: true })
		),
		'~optional',
		optionalTrue
	) as any
}
