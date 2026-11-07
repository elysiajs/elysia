import { Decode, Refine } from '../typebox-type'
import type { Type } from 'typebox'
import type { TNumberOptions, TSchema } from 'typebox'

import { isEmpty } from '../../utils'
import { Errors } from '../bridge'
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

// TypeBox takes a number or a bigint limit, compared natively
const isLimit = (limit: unknown): limit is number | bigint =>
	typeof limit === 'number' || typeof limit === 'bigint'

// TypeBox's range check, without its message: a fraction fails a bigint
// `multipleOf` (TypeBox's `BigInt(n)` would throw)
function inRange(n: number, c: TNumberOptions) {
	if (isLimit(c.exclusiveMaximum) && n >= c.exclusiveMaximum) return false
	if (isLimit(c.exclusiveMinimum) && n <= c.exclusiveMinimum) return false
	if (isLimit(c.maximum) && n > c.maximum) return false
	if (isLimit(c.minimum) && n < c.minimum) return false

	const d = c.multipleOf as unknown
	if (typeof d === 'bigint')
		return Number.isInteger(n) && BigInt(n) % d === 0n

	if (typeof d !== 'number' || (Number.isInteger(n) && (1 / d) % 1 === 0))
		return true

	// TypeBox's float tolerance: 0.3 is a multiple of 0.1
	const mod = n % d
	return Math.min(Math.abs(mod), Math.abs(mod - d)) < 1e-10
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

		const node: any = Refine(
			Union(
				[
					number,
					Decode(
						Refine(StringType(), grammar, () => message),
						(value) => +value
					)
				] as any,
				meta
			),
			(value) => typeof value !== 'string' || inRange(+value, c),
			// failure only: TypeBox words the range, in its active locale
			(value) => {
				try {
					return Errors(number, +value)[0]?.message ?? message
				} catch {
					return message
				}
			}
		)

		// after `Refine`, which clones the branches. Pure: reads only `c`,
		// which is never mutated after `getMeta`
		pureRefine(node.anyOf[1])

		return elyType(tag, pureRefine(node))
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
