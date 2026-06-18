import type { TOptional, TSchema } from 'typebox'

let optionalProperty: {
	enumerable: false
}
let optionalPropertyWithValue: {
	value: true
	enumerable: false
	configurable: true
}
let OptionalShared: WeakMap<TSchema, TSchema>
export function Optional<T extends TSchema>(schema: T): TOptional<T> {
	if (OptionalShared?.has(schema)) return OptionalShared.get(schema) as any

	if (Object.isFrozen(schema)) {
		const result = Object.defineProperty(
			Object.create(schema),
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

	// @ts-expect-error
	schema['~optional'] = true
	return Object.defineProperty(
		schema,
		'~optional',
		(optionalProperty ??= {
			enumerable: false
		})
	) as any
}
