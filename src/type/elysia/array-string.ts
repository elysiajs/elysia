import { Decode, Refine } from 'typebox/type'
import type { TObjectOptions, TSchema } from 'typebox'
import { Check, Decode as decodeValue } from 'typebox/value'

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

	const arrayString = Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 91) return false

				if (!globalThis.__ELYSIA_SEALED__)
					try {
						return Check(array, JSON.parse(value))
					} catch {
						return false
					}

				throw 0
			},
			() => 'must be an array'
		),
		(value) => {
			if (!globalThis.__ELYSIA_SEALED__)
				return decodeValue(array, JSON.parse(value))

			throw 0
		}
	)

	return elyType(ELYSIA_TYPES.ArrayString, Union([array, arrayString], meta))
}
