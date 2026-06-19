import { Number } from 'typebox/type'
import type { TNumber, TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyNumber = Object.freeze(Number())
export function NumberType(options?: TNumberOptions): TNumber {
	if (!options || isEmpty(options)) return emptyNumber

	options.type = 'number'
	options['~kind'] = 'Number'
	return Object.defineProperty(options, '~kind', noEnumerable) as any
}
