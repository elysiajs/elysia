import type { TArray, TSchema, TSchemaOptions } from 'typebox'
import { isEmpty } from '../../utils'

let arrayKind: {
	value: 'Array'
	enumerable: false
}
let arrayProto: { '~kind': 'Array' }
export function ArrayType<T extends TSchema>(
	items: T,
	options?: TSchemaOptions
): TArray<T> {
	if (!options || isEmpty(options)) {
		arrayProto ??= Object.defineProperty({}, '~kind', {
			value: 'Array',
			enumerable: false
		}) as { '~kind': 'Array' }

		const schema = Object.create(arrayProto) as TArray<T>
		;(schema as any).type = 'array'
		;(schema as any).items = items
		return schema
	}

	arrayKind ??= {
		value: 'Array',
		enumerable: false
	}

	const schema: any = { ...options, type: 'array', items }
	Object.defineProperty(schema, '~kind', arrayKind)

	return schema
}
