import type { TOptional, TSchema } from 'typebox'

import { copyNonEnumerable } from './utils'

let optionalPropertyWithValue: {
	value: true
	enumerable: false
	configurable: true
}
let OptionalShared: WeakMap<TSchema, TSchema>
export function Optional<T extends TSchema>(schema: T): TOptional<T> {
	if (OptionalShared?.has(schema)) return OptionalShared.get(schema) as any

	const result = Object.assign(
		Object.create(Object.getPrototypeOf(schema)),
		schema
	)
	copyNonEnumerable(schema, result)
	Object.defineProperty(
		result,
		'~optional',
		(optionalPropertyWithValue ??= {
			value: true,
			enumerable: false,
			configurable: true
		})
	)

	OptionalShared ??= new WeakMap()
	OptionalShared.set(schema, result)

	return result
}
