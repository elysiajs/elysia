import { Decode, Refine } from '../typebox-type'
import type { TSchemaOptions, Type } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { NumberType } from './number'
import { StringType } from './string'
import { Union } from './union'
import { elyType } from './utils'

export type AssertNumericEnum<T extends Record<string, string | number>> = {
	[K in keyof T]: K extends number
		? string
		: K extends `${number}`
			? string
			: K extends string
				? number
				: never
}

type NumericEnumValue<T> = Extract<T[keyof T], number>

// a client may send a member as a number or its numeric string
type NumericEnumSchema<T> = Type.TCodec<
	Type.TRefine<Type.TUnsafe<NumericEnumValue<T> | `${NumericEnumValue<T>}`>>,
	NumericEnumValue<T>
>

/**
 * Numeric enum: accepts a numeric string or a number, decodes to the
 * matching enum value.
 */
export function NumericEnum<T extends AssertNumericEnum<T>>(
	item: T,
	property?: TSchemaOptions
): Readonly<NumericEnumSchema<T>> {
	const allowed = new Set(
		Object.values(item as Record<string, string | number>).filter(
			(v) => typeof v === 'number'
		)
	)

	const decoder = Decode(
		Refine(
			Union([StringType({ format: 'numeric' }), NumberType()], property),
			(value) => {
				if (typeof value === 'string' && value.trim() === '')
					return false

				const n = +value
				return !isNaN(n) && allowed.has(n)
			},
			() => 'must be a member of the enum'
		),
		// `+value` passed the `allowed` membership refine above
		(value) => +value as NumericEnumValue<T>
	)

	return elyType(ELYSIA_TYPES.Numeric, decoder) as unknown as Readonly<
		NumericEnumSchema<T>
	>
}
