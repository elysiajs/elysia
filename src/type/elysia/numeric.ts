import { Decode, Refine } from 'typebox/type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import { pureRefine } from '../shared'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

// A finite decimal numeric string: optional sign + digits/decimal point
// Rejects hex (`0x10`), binary/octal, scientific (`1e3`) and `Infinity`/`NaN`
// Single-pass charCode scan of `/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/`, which is
// hot on every query/params coercion. `\d` without `u` is ASCII `[0-9]`, so
// fullwidth/arabic-indic digits stay rejected
function isDecimalString(value: string): boolean {
	const length = value.length

	let index = 0
	const sign = value.charCodeAt(0)
	// '+' '-'
	if (sign === 43 || sign === 45) index = 1

	let digits = 0
	while (index < length) {
		const char = value.charCodeAt(index)
		if (char < 48 || char > 57) break

		index++
		digits++
	}

	// '.'
	if (index < length && value.charCodeAt(index) === 46) {
		index++

		let fractions = 0
		while (index < length) {
			const char = value.charCodeAt(index)
			if (char < 48 || char > 57) break

			index++
			fractions++
		}

		// a lone '.', '+.' or '-.'
		if (!digits && !fractions) return false
	} else if (!digits) return false

	// anything left over is garbage: '1e5', '0x10', '1 ', '1.2.3'
	return index === length
}

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
	StringifiedNumber ??= pureRefine(
		Decode(
			Refine(StringType(), isDecimalString, () => 'must be number'),
			(value) => +value
		)
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
				if (!isDecimalString(value)) return false
				return passesConstraints(+value, constraints as any)
			},
			() => 'must be number'
		),
		(value) => +value
	)

	pureRefine(stringified)

	return elyType(
		ELYSIA_TYPES.Numeric,
		Union([number, stringified] as any, meta) as NumericSchema
	)
}
