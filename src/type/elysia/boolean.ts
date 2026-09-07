import type { TBoolean, TSchemaOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyBoolean = Object.freeze(
	Object.defineProperty(
		{ type: 'boolean', '~kind': 'Boolean' },
		'~kind',
		noEnumerable
	) as any as TBoolean
)
export function BooleanType(options?: TSchemaOptions): TBoolean {
	if (!options || isEmpty(options)) return emptyBoolean

	const schema = { ...options, type: 'boolean', '~kind': 'Boolean' }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
