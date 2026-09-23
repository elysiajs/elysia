import type { TBoolean, TSchemaOptions } from 'typebox'

import { primitive } from './number'

const boolean = /* @__PURE__ */ primitive('boolean', 'Boolean')

export function BooleanType(options?: TSchemaOptions): TBoolean {
	return boolean(options)
}
