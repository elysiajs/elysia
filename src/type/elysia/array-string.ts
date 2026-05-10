import { Type } from 'typebox'
import type { TObjectOptions, TProperties } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import { ArrayType } from './array'
import { StringType } from './string'
import { Union } from './union'
import { elyType, getMeta } from './utils'

let BaseArrayString: Type.TCodec<Type.TRefine<Type.TString>, any>
export function ArrayString<T extends TProperties>(
	property: T,
	_options?: TObjectOptions
) {
	BaseArrayString ??= Type.Decode(
		Type.Refine(
			StringType(),
			(value) => {
				if (
					value.charCodeAt(0) !== 91 &&
					value.charCodeAt(value.length - 1) !== 93
				)
					return false

				try {
					JSON.parse(value)

					return true
				} catch {
					return false
				}
			},
			'must be an array'
		),
		(value) => JSON.parse(value)
	)

	// `property` is the items schema (e.g. `t.Numeric()`), `_options` is
	// the source `t.Array(...)` node minus `type`. Constraints/meta
	// (`minItems`, `maxItems`, `description`, etc.) live on `_options`,
	// NOT on the items. Reading them off `property` produced a malformed
	// schema where the items' fields (e.g. Numeric's `anyOf`) bled into
	// the wrapper Array - `t.Array(t.Numeric())` came out as
	// `{type:'array', items, anyOf, ~elyTyp:Numeric}` and validation
	// against `['1','2']` failed at the top level.
	const [constraints, meta] = getMeta((_options ?? {}) as any)
	const array = ArrayType(property as any, constraints)

	return elyType(
		ELYSIA_TYPES.ArrayString,
		Union([array, Intersect([BaseArrayString, array])], meta)
	)
}
