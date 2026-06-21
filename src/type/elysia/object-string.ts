import { Decode, Refine } from 'typebox/type'
import type { TObjectOptions, TProperties } from 'typebox'
import { Check, Decode as decodeValue } from 'typebox/value'

import { ELYSIA_TYPES } from '../constants'
import { ObjectType } from './object'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'
import { nullObject } from '../../utils'

export function ObjectString<T extends TProperties>(
	property: T,
	_options?: TObjectOptions
) {
	const [{ properties, ...constraints }, meta] = getMeta(
		(_options ?? nullObject()) as any
	)
	const object = ObjectType(property, constraints)

	const objectString = Decode(
		Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 123) return false

				if (!globalThis.ELY_SEALED)
					try {
						return Check(object, JSON.parse(value))
					} catch {
						return false
					}

				throw 0
			},
			() => 'must be an object'
		),
		(value) => {
			if (!globalThis.ELY_SEALED)
				return decodeValue(object, JSON.parse(value))

			throw 0
		}
	)

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, objectString], meta)
	)
}
