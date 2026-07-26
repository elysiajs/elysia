import { Decode, Refine } from 'typebox/type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { pureRefine } from '../shared'
import { Integer } from './integer'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let StringifiedInteger: Type.TCodec<Type.TRefine<Type.TString>, number>
let StrictInteger: Type.TRefine<Type.TNumber>
type IntegerStringSchema = Type.TUnion<
	[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
>
let emptyIntegerString: Readonly<IntegerStringSchema>
export function IntegerString(property?: TNumberOptions) {
	StringifiedInteger ??= pureRefine(
		Decode(
			Refine(
				StringType(),
				(value) => /^[+-]?\d+$/.test(value) && Number.isInteger(+value),
				() => 'must be integer'
			),
			(value) => +value
		)
	)

	StrictInteger ??= pureRefine(
		Refine(
			NumberType(),
			(value) => Number.isInteger(value),
			() => 'must be integer'
		)
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
				// decimal only
				if (!/^[+-]?\d+$/.test(value)) return false
				const n = +value

				if (!Number.isInteger(n)) return false
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

	// pure: reads only `c`, which is never mutated after `getMeta`
	pureRefine(stringified)

	return elyType(
		ELYSIA_TYPES.Integer,
		Union([integer, stringified] as any, meta) as IntegerStringSchema
	)
}
