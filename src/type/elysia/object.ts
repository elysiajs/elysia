import type { TObject, TObjectOptions, TProperties } from 'typebox'

import { isEmpty } from '../../utils'

let objectKind: {
	value: 'Object'
	enumerable: false
}
let objectProto: { '~kind': 'Object' }
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

	if (!options || isEmpty(options)) {
		objectProto ??= Object.defineProperty({}, '~kind', {
			value: 'Object',
			enumerable: false
		}) as { '~kind': 'Object' }

		const schema = Object.create(objectProto) as TObject<T>
		;(schema as any).type = 'object'
		;(schema as any).properties = properties
		;(schema as any).required = required
		return schema
	}

	objectKind ??= {
		value: 'Object',
		enumerable: false
	}

	const schema: any = { ...options, type: 'object', properties, required }
	Object.defineProperty(schema, '~kind', objectKind)

	return schema
}
