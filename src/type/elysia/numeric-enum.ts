import { Type } from 'typebox'
import type { TSchemaOptions } from 'typebox'

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

/**
 * Numeric enum: accepts a numeric string or a number, decodes to the
 * matching enum value. Mirrors src-old `t.NumericEnum`.
 */
export function NumericEnum<T extends AssertNumericEnum<T>>(
	item: T,
	property?: TSchemaOptions
) {
	const allowed = new Set(
		Object.values(item as Record<string, string | number>)
			.filter((v) => typeof v === 'number')
			.map((v) => v as number)
	)

	const decoder = Type.Decode(
		Type.Refine(
			Union([StringType({ format: 'numeric' }), NumberType()], property),
			(value) => {
				const n = +value
				return !isNaN(n) && allowed.has(n)
			},
			'must be a member of the enum'
		),
		(value) => +value
	)

	// Cast to a generic typebox enum-like; runtime is the decoder above.
	return elyType(ELYSIA_TYPES.Numeric, decoder) as any
}
