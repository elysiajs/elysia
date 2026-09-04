import type { TNumber, TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyNumber = Object.freeze(
	Object.defineProperty(
		{ type: 'number', '~kind': 'Number' },
		'~kind',
		noEnumerable
	) as any as TNumber
)
export function NumberType(options?: TNumberOptions): TNumber {
	if (!options || isEmpty(options)) return emptyNumber

	const schema = { ...options, type: 'number', '~kind': 'Number' }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
