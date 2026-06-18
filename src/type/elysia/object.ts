import type { TObject, TObjectOptions, TProperties } from 'typebox'

import { isEmpty } from '../../utils'

let objectKind: {
	value: 'Object'
	enumerable: false
}
// Shared prototype carrying a non-enumerable `~kind: 'Object'`. Placing it on
// the prototype (instead of an own property via Object.defineProperty) lets the
// fast path build the schema with a plain object literal, avoiding the costly
// per-call defineProperty deopt while keeping `~kind` non-enumerable and
// reachable through `'~kind' in schema` (the access TypeBox and Elysia use).
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

	Object.defineProperty(options, '~kind', objectKind)
	options.type = 'object'
	options.properties = properties
	options.required = required

	return options as any
}
