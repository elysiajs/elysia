import type { TArray, TSchema, TSchemaOptions } from 'typebox'
import { isEmpty } from '../../utils'

const arrayKind = { value: 'Array', enumerable: false } as const
let arrayProto: { '~kind': 'Array' }
export function ArrayType<T extends TSchema>(
	items: T,
	options?: TSchemaOptions
): TArray<T> {
	if (!options || isEmpty(options)) {
		arrayProto ??= Object.defineProperty({}, '~kind', arrayKind) as {
			'~kind': 'Array'
		}

		const schema = Object.create(arrayProto) as TArray<T>
		;(schema as any).type = 'array'
		;(schema as any).items = items

		return schema
	}

	const schema: any = { ...options, type: 'array', items }
	Object.defineProperty(schema, '~kind', arrayKind)

	return schema
}
