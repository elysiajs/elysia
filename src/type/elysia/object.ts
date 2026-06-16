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
	const keys = Object.keys(properties)

	// faster than loop splice despite being O(2n)
	let optional = 0
	for (let i = 0; i < keys.length; i++)
		// @ts-expect-error
		if (properties[keys[i]]['~optional']) optional++

	let required: string[]
	if (optional === 0) required = keys
	else {
		required = new Array(keys.length - optional)
		let j = 0
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i]
			// @ts-expect-error
			if (!properties[key]['~optional']) required[j++] = key
		}
	}

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
