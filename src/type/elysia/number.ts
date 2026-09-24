import type { TNumber, TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

// `{ type, '~kind' }` builder, frozen singleton when called without options
export function primitive(type: string, kind: string) {
	const empty = Object.freeze(
		Object.defineProperty({ type, '~kind': kind }, '~kind', noEnumerable)
	)

	return (options?: object): any => {
		if (!options || isEmpty(options)) return empty

		const schema = { ...options, type, '~kind': kind }
		return Object.defineProperty(schema, '~kind', noEnumerable)
	}
}

const number = /* @__PURE__ */ primitive('number', 'Number')

export function NumberType(options?: TNumberOptions): TNumber {
	return number(options)
}
