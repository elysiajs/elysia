import type { TInteger, TNumberOptions } from 'typebox'

import { primitive } from './number'

const integer = /* @__PURE__ */ primitive('integer', 'Integer')

export function Integer(options?: TNumberOptions): TInteger {
	return integer(options)
}
