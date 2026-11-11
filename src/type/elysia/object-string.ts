import type { TObjectOptions, TProperties } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { jsonString } from './json-string'
import { ObjectType } from './object'
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

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, jsonString(object, 123, 'must be an object')], meta)
	)
}
