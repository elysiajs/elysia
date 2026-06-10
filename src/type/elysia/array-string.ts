import { Type } from 'typebox'
import type { TObjectOptions, TSchema } from 'typebox'
import { Value } from 'typebox/value'

import { ELYSIA_TYPES } from '../constants'
import { ArrayType } from './array'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'
import { nullObject } from '../../utils'

export function ArrayString<T extends TSchema>(
	property: T,
	_options?: TObjectOptions
) {
	const [constraints, meta] = getMeta((_options ?? nullObject()) as any)
	const array = ArrayType(property, constraints)

	const arrayString = Type.Decode(
		Type.Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 91) return false

				try {
					return Value.Check(array, JSON.parse(value))
				} catch {
					return false
				}
			},
			'must be an array'
		),
		(value) => Value.Decode(array, JSON.parse(value))
	)

	return elyType(ELYSIA_TYPES.ArrayString, Union([array, arrayString], meta))
}
