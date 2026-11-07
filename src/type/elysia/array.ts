import type { TArray, TSchema, TSchemaOptions } from 'typebox'

const arrayKind = { value: 'Array', enumerable: false } as const
export function ArrayType<T extends TSchema>(
	items: T,
	options?: TSchemaOptions
): TArray<T> {
	// own `~kind`, see ObjectType
	return Object.defineProperty(
		{ ...options, type: 'array', items },
		'~kind',
		arrayKind
	) as any
}
