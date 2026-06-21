import { Decode, Refine } from 'typebox/type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

// A finite decimal numeric string: optional sign + digits/decimal point
// Rejects hex (`0x10`), binary/octal, scientific (`1e3`) and `Infinity`/`NaN`
const decimalNumber = /^[+-]?(\d+\.?\d*|\.\d+)$/

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
			// only a finite decimal string (also rejects empty/blank, since
			// `+'' === 0` would otherwise silently pass)
			(value) => decimalNumber.test(value),
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
				if (!decimalNumber.test(value)) return false
				return passesConstraints(+value, constraints as any)
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
