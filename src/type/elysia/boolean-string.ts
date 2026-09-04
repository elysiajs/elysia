import { Decode, Refine } from '../typebox-type'
import type { Type } from 'typebox'
import type { TSchemaOptions } from 'typebox'

import { elyType, getMeta } from './utils'
import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { pureRefine } from '../shared'

import { BooleanType } from './boolean'
import { StringType } from './string'
import { Union } from './union'

let StringifiedBoolean: Type.TCodec<Type.TRefine<Type.TString>, boolean>
let emptyBooleanString: Readonly<
	Type.TUnion<
		[Type.TBoolean, Type.TCodec<Type.TRefine<Type.TString>, boolean>]
	>
>
export function BooleanString(property?: TSchemaOptions) {
	StringifiedBoolean ??= pureRefine(
		Decode(
			Refine(
				StringType(),
				(value) => value === 'true' || value === 'false',
				() => 'must be boolean'
			),
			(value) => (value === 'true' ? true : false)
		)
	)

	if (!property || isEmpty(property))
		return (emptyBooleanString ??= Object.freeze(
			elyType(
				ELYSIA_TYPES.BooleanString,
				Union([BooleanType(), StringifiedBoolean])
			)
		))

	const [, meta] = getMeta(property)
	const boolean = BooleanType(property)

	return elyType(
		ELYSIA_TYPES.BooleanString,
		Union([boolean, StringifiedBoolean], meta)
	)
}
