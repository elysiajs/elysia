import { Integer as IntegerType } from 'typebox/type'
import type { TInteger, TNumberOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyInteger = Object.freeze(IntegerType())
export function Integer(options?: TNumberOptions): TInteger {
	if (!options || isEmpty(options)) return emptyInteger as any

	const schema = { ...options, type: 'integer', '~kind': 'Integer' }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
