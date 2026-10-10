import type { TObjectOptions, TSchema } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { ArrayType } from './array'
import { jsonString } from './json-string'
import { Union } from './union'
import { elyType, getMeta } from './utils'
import { nullObject } from '../../utils'

export function ArrayString<T extends TSchema>(
	property: T,
	_options?: TObjectOptions
) {
	const [constraints, meta] = getMeta((_options ?? nullObject()) as any)
	const array = ArrayType(property, constraints)

	return elyType(
		ELYSIA_TYPES.ArrayString,
		Union([array, jsonString(array, 91, 'must be an array')], meta)
	)
}
