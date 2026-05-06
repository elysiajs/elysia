import { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import { Integer } from './integer'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let StringifiedInteger: Type.TCodec<Type.TRefine<Type.TString>, number>
let emptyIntegerString: Readonly<
	Type.TUnion<
		[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
	>
>
export function IntegerString(property?: TNumberOptions) {
	StringifiedInteger = Type.Decode(
		Type.Refine(
			StringType(),
			(value) => !isNaN(+value) && Number.isInteger(+value),
			'must be integer'
		),
		(value) => +value
	)

	if (!property || isEmpty(property))
		return (emptyIntegerString ??= elyType(
			ELYSIA_TYPES.Integer,
			Union([Integer(), StringifiedInteger])
		))

	const [constraints, meta] = getMeta(property)
	const integer = Integer(constraints)

	return elyType(
		ELYSIA_TYPES.Integer,
		Union([integer, Intersect([StringifiedInteger, integer])], meta)
	)
}
