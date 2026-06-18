import { Type } from 'typebox'
import type { TSchemaOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { BooleanType } from './boolean'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let StringifiedBoolean: Type.TCodec<Type.TRefine<Type.TString>, boolean>
let emptyBooleanString: Readonly<
	Type.TUnion<
		[Type.TBoolean, Type.TCodec<Type.TRefine<Type.TString>, boolean>]
	>
>
export function BooleanString(property?: TSchemaOptions) {
	StringifiedBoolean ??= Type.Decode(
		Type.Refine(
			StringType(),
			(value) => value === 'true' || value === 'false',
			() => 'must be boolean'
		),
		(value) => (value === 'true' ? true : false)
	)

	if (!property || isEmpty(property))
		return (emptyBooleanString ??= elyType(
			ELYSIA_TYPES.BooleanString,
			Union([BooleanType(), StringifiedBoolean])
		))

	const [, meta] = getMeta(property)
	const boolean = BooleanType(property)

	return elyType(
		ELYSIA_TYPES.BooleanString,
		Union([boolean, StringifiedBoolean], meta)
	)
}
