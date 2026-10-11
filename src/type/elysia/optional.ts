import type { TOptional, TSchema } from 'typebox'

import { copyNonEnumerable } from '../shared'

const optionalTrue = {
	value: true,
	enumerable: false,
	configurable: true
} as const
let OptionalShared: WeakMap<TSchema, TSchema>
export function Optional<T extends TSchema>(schema: T): TOptional<T> {
	if (OptionalShared?.has(schema)) return OptionalShared.get(schema) as any

	const result = Object.assign(
		Object.create(Object.getPrototypeOf(schema)),
		schema
	)
	copyNonEnumerable(schema, result)
	Object.defineProperty(result, '~optional', optionalTrue)

	OptionalShared ??= new WeakMap()
	OptionalShared.set(schema, result)

	return result
}
