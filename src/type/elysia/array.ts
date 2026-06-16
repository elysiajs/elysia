import type { TArray, TSchema, TSchemaOptions } from 'typebox'
import { isEmpty } from '../../utils'

let arrayKind: {
	value: 'Array'
	enumerable: false
}
export function ArrayType<T extends TSchema>(
	items: T,
	options?: TSchemaOptions
): TArray<T> {
	arrayKind ??= {
		value: 'Array',
		enumerable: false
	}

	if (!options || isEmpty(options)) {
		const schema = {
			type: 'array' as const,
			items
		}

		Object.defineProperty(schema, '~kind', arrayKind)
		return schema as any
	}

	Object.defineProperty(options, '~kind', arrayKind)
	options.type = 'array'
	options.items = items

	return options as any
}
