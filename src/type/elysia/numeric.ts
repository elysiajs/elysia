import { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let StringifiedNumber: Type.TCodec<Type.TRefine<Type.TString>, number>
let emptyNumeric: Readonly<
	Type.TUnion<[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]>
>
export function Numeric(property?: TNumberOptions) {
	StringifiedNumber ??= Type.Decode(
		Type.Refine(StringType(), (value) => !isNaN(+value), 'must be number'),
		(value) => +value
	)

	if (!property || isEmpty(property))
		return (emptyNumeric ??= Object.freeze(
			elyType(
				ELYSIA_TYPES.Numeric,
				Union([NumberType(), StringifiedNumber])
			)
		))

	const [constraints, meta] = getMeta(property)
	const number = NumberType(constraints)

	return elyType(
		ELYSIA_TYPES.Numeric,
		Union([number, Intersect([StringifiedNumber, number])], meta)
	)
}
