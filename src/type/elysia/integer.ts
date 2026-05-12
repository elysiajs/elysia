import { Type } from 'typebox'
import type { TInteger, TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyInteger = Object.freeze(Type.Integer())
export function Integer(options?: TNumberOptions): TInteger {
	if (!options || isEmpty(options)) return emptyInteger as any

	options.type = 'integer'
	options['~kind'] = 'Integer'
	return Object.defineProperty(options, '~kind', noEnumerable) as any
}
