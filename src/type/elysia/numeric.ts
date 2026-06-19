import { Decode, Refine } from 'typebox/type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let StringifiedNumber: Type.TCodec<Type.TRefine<Type.TString>, number>
type NumericSchema = Type.TUnion<
	[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
let emptyNumeric: Readonly<NumericSchema>

function passesConstraints(n: number, c: TNumberOptions): boolean {
	if (typeof c.minimum === 'number' && n < c.minimum) return false
	if (typeof c.maximum === 'number' && n > c.maximum) return false

	if (typeof c.exclusiveMinimum === 'number' && n <= c.exclusiveMinimum)
		return false

	if (typeof c.exclusiveMaximum === 'number' && n >= c.exclusiveMaximum)
		return false

	if (typeof c.multipleOf === 'number' && n % c.multipleOf !== 0) return false

	return true
}

export function Numeric(property?: TNumberOptions) {
	StringifiedNumber ??= Decode(
		Refine(
			StringType(),
			// reject empty/blank strings: `+'' === 0` would silently pass
			(value) => value.trim() !== '' && !isNaN(+value),
			() => 'must be number'
		),
		(value) => +value
	)

	if (!property || isEmpty(property))
		return (emptyNumeric ??= Object.freeze(
			elyType(
				ELYSIA_TYPES.Numeric,
				Union([NumberType(), StringifiedNumber])
			) as NumericSchema
		))

	const [constraints, meta] = getMeta(property)
	const number = NumberType(constraints)
	const stringified = Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.trim() === '') return false
				const n = +value
				return !isNaN(n) && passesConstraints(n, constraints as any)
			},
			() => 'must be number'
		),
		(value) => +value
	)

	return elyType(
		ELYSIA_TYPES.Numeric,
		Union([number, stringified] as any, meta) as NumericSchema
	)
}
