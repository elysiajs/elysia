import { Type } from 'typebox'
import type { TBoolean, TSchemaOptions } from 'typebox'

import { isEmpty } from '../../utils'
import { noEnumerable } from '../constants'

const emptyBoolean = Object.freeze(Type.Boolean())
export function BooleanType(options?: TSchemaOptions): TBoolean {
	if (!options || isEmpty(options)) return emptyBoolean

	options.type = 'boolean'
	options['~kind'] = 'Boolean'
	return Object.defineProperty(options, '~kind', noEnumerable) as any
}
