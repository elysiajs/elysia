import { Decode, Refine } from 'typebox/type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { Integer } from './integer'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

// A finite decimal integer string: optional sign + digits
// Rejects hex (`0x10`), binary/octal, scientific (`1e3`) and `Infinity`/`NaN`
const decimalInteger = /^[+-]?\d+$/

let StringifiedInteger: Type.TCodec<Type.TRefine<Type.TString>, number>
let StrictInteger: Type.TRefine<Type.TNumber>
type IntegerStringSchema = Type.TUnion<
	[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
let emptyIntegerString: Readonly<IntegerStringSchema>
export function IntegerString(property?: TNumberOptions) {
	StringifiedInteger ??= Decode(
		Refine(
			StringType(),
			// only a finite decimal integer string (also rejects empty/blank,
			// since `+'' === 0` would otherwise silently pass)
			(value) => decimalInteger.test(value),
			() => 'must be integer'
		),
		(value) => +value
	)

	StrictInteger ??= Refine(
		NumberType(),
		(value) => Number.isInteger(value),
		() => 'must be integer'
	)

	if (!property || isEmpty(property))
		return (emptyIntegerString ??= Object.freeze(
			elyType(
				ELYSIA_TYPES.Integer,
				Union([StrictInteger, StringifiedInteger]) as any
			)
		) as IntegerStringSchema)

	const [constraints, meta] = getMeta(property)
	const integer = Integer(constraints)

	const c = constraints as TNumberOptions
	const stringified = Decode(
		Refine(
			StringType(),
			(value) => {
				if (!decimalInteger.test(value)) return false
				const n = +value
				if (isNaN(n) || !Number.isInteger(n)) return false
				if (typeof c.minimum === 'number' && n < c.minimum) return false
				if (typeof c.maximum === 'number' && n > c.maximum) return false
				if (
					typeof c.exclusiveMinimum === 'number' &&
					n <= c.exclusiveMinimum
				)
					return false
				if (
					typeof c.exclusiveMaximum === 'number' &&
					n >= c.exclusiveMaximum
				)
					return false
				if (typeof c.multipleOf === 'number' && n % c.multipleOf !== 0)
					return false
				return true
			},
			() => 'must be integer'
		),
		(value) => +value
	)

	return elyType(
		ELYSIA_TYPES.Integer,
		Union([integer, stringified] as any, meta) as IntegerStringSchema
	)
}
