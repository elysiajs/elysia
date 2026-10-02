import { Decode, Refine } from '../typebox-type'
import type { Type } from 'typebox'
import type { TNumberOptions, TSchema } from 'typebox'

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
function isDecimalString(value: string) {
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
	if (index !== length) return false

	// only 309+ digits can exceed MAX_VALUE
	return digits < 309 || Number.isFinite(+value)
}

function inRange(n: number, c: TNumberOptions) {
	if (typeof c.minimum === 'number' && n < c.minimum) return false
	if (typeof c.maximum === 'number' && n > c.maximum) return false
	if (typeof c.exclusiveMinimum === 'number' && n <= c.exclusiveMinimum)
		return false
	if (typeof c.exclusiveMaximum === 'number' && n >= c.exclusiveMaximum)
		return false
	if (typeof c.multipleOf === 'number' && n % c.multipleOf !== 0)
		return false

	return true
}

// `base` or a numeric string matching `grammar`, decoded to a number
export function numericString(
	tag: ELYSIA_TYPES[keyof ELYSIA_TYPES],
	message: string,
	grammar: (value: string) => boolean,
	base: (constraints: TNumberOptions) => TSchema,
	emptyBase: () => TSchema
) {
	let empty: TSchema | undefined

	return (property?: TNumberOptions) => {
		if (!property || isEmpty(property))
			return (empty ??= Object.freeze(
				elyType(
					tag,
					Union([
						emptyBase(),
						pureRefine(
							Decode(
								Refine(StringType(), grammar, () => message),
								(value) => +value
							)
						)
					])
				)
			))

		const [constraints, meta] = getMeta(property)
		const c = constraints as TNumberOptions
		const number = base(constraints)
		const stringified = Decode(
			Refine(
				StringType(),
				(value) => grammar(value) && inRange(+value, c),
				() => message
			),
			(value) => +value
		)

		// pure: reads only `c`, which is never mutated after `getMeta`
		pureRefine(stringified)

		return elyType(tag, Union([number, stringified] as any, meta))
	}
}

type NumericSchema = Type.TUnion<
	[Type.TNumber, Type.TCodec<Type.TRefine<Type.TString>, number>]
>

const numeric = /* @__PURE__ */ numericString(
	ELYSIA_TYPES.Numeric,
	'must be number',
	isDecimalString,
	NumberType,
	NumberType
)

export function Numeric(property?: TNumberOptions): Readonly<NumericSchema> {
	return numeric(property) as NumericSchema
}
