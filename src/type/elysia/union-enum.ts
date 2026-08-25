import { Unsafe } from '../typebox-type'
import type { TSchemaOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import type { NonEmptyArray, TEnumValue, TUnionEnum } from '../types'
import { elyType } from './utils'

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

	// User-supplied `default` wins over values[0]; never mutate the options bag.
	const schema = Object.defineProperty(
		{ default: values[0], ...options, enum: values },
		'~kind',
		(unionEnumNoEnumerable ??= {
			value: 'UnionEnum',
			enumerable: false
		})
	) as any as TUnionEnum<T>

	if (!mixed) schema.type = kind

	return elyType(ELYSIA_TYPES.UnionEnum, Unsafe<T[number]>(schema))
}
