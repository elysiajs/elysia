import { Type } from 'typebox'
import type { TObjectOptions, TProperties } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import { ObjectType } from './object'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let BaseObjectString: Type.TCodec<
	Type.TRefine<Type.TString>,
	Record<string | number | symbol, unknown>
>
export function ObjectString<T extends TProperties>(
	property: T,
	_options?: TObjectOptions
) {
	BaseObjectString ??= Object.freeze(
		Type.Decode(
			Type.Refine(
				StringType(),
				(value) => {
					if (
						(value.charCodeAt(0) !== 123 &&
							value.charCodeAt(value.length - 1) !== 125) ||
						(value.charCodeAt(0) !== 91 &&
							value.charCodeAt(value.length - 1) !== 93)
					)
						return false

					try {
						JSON.parse(value)

						return true
					} catch {
						return false
					}
				},
				'must be an object'
			),
			(value) => JSON.parse(value)
		)
	)

	const [{ properties, ...constraints }, meta] = getMeta(property)
	const object = ObjectType(property, constraints)

	return elyType(
		ELYSIA_TYPES.ObjectString,
		Union([object, Intersect([BaseObjectString, object])], meta)
	)
}
