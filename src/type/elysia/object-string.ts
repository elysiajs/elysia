import { Type } from 'typebox'
import type { TObjectOptions, TProperties } from 'typebox'
import { Value } from 'typebox/value'

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

	const objectString = Type.Decode(
		Type.Refine(
			StringType(),
			(value) => {
				if (value.charCodeAt(0) !== 123) return false

				try {
					return Value.Check(object, JSON.parse(value))
				} catch {
					return false
				}
			},
			() => 'must be an object'
		),
		(value) => Value.Decode(object, JSON.parse(value))
	)

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, objectString], meta)
	)
}
