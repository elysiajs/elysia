import { Type } from 'typebox'
import type { TSchemaOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import type { NonEmptyArray, TEnumValue, TUnionEnum } from '../types'
import { assignOrNew, elyType } from './utils'

let unionEnumNoEnumerable: {
	value: 'UnionEnum'
	enumerable: false
}
export function UnionEnum<
	const T extends
		| NonEmptyArray<TEnumValue>
		| Readonly<NonEmptyArray<TEnumValue>>
>(values: T, options?: TSchemaOptions) {
	let kind: 'string' | 'number' | 'null' | undefined
	let mixed = false

	for (const v of values) {
		if (typeof v === 'object' && v !== null)
			throw new Error('This type does not support objects or arrays')

		const type = v === null ? 'null' : typeof v

		if (!kind) kind = type as any
		else if (kind !== type) mixed = true
	}

	const schema = Object.defineProperty(
		assignOrNew(options, {
			default: values[0],
			enum: values
		}),
		'~kind',
		(unionEnumNoEnumerable ??= {
			value: 'UnionEnum',
			enumerable: false
		})
	) as any as TUnionEnum<T>

	if (!mixed) schema.type = kind

	// Static (output) type is the union of the enum values (`T[number]`), not
	// the `TUnionEnum<T>` schema interface — `Type.Unsafe<TUnionEnum<T>>` would
	// surface the schema shape in handler/Eden context instead of the value.
	// The runtime `schema` (carrying `~kind`/`enum`/`type` for validation) and
	// the `elyType` tag are unchanged.
	return elyType(ELYSIA_TYPES.UnionEnum, Type.Unsafe<T[number]>(schema))
}
