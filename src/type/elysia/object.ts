import type { TObject, TObjectOptions, TProperties } from 'typebox'

import { isEmpty } from '../../utils'

let objectKind: {
	value: 'Object'
	enumerable: false
}
export function ObjectType<T extends TProperties>(
	properties: T,
	options?: TObjectOptions
): TObject<T> {
	const required = Object.keys(properties)
	for (let i = 0; i < required.length; i++)
		// @ts-expect-error
		if (properties[required[i]]['~optional']) required.splice(i--, 1)

	objectKind ??= {
		value: 'Object',
		enumerable: false
	}

	if (!options || isEmpty(options)) {
		const schema = {
			type: 'object' as const,
			properties,
			required
		}
		Object.defineProperty(schema, '~kind', objectKind)
		return schema as any
	}

	Object.defineProperty(options, '~kind', objectKind)
	options.type = 'object'
	options.properties = properties
	options.required = required

	return options as any
}
