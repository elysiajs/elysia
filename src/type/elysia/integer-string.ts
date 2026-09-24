import { Refine } from '../typebox-type'
import type { Type } from 'typebox'
import type { TNumberOptions } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { pureRefine } from '../shared'
import { Integer } from './integer'
import { NumberType } from './number'
import { numericString } from './numeric'

type IntegerStringSchema = Type.TUnion<
	[Type.TInteger, Type.TCodec<Type.TRefine<Type.TString>, number>]
>

const integerString = /* @__PURE__ */ numericString(
	ELYSIA_TYPES.Integer,
	'must be integer',
	// decimal only; only 309+ digits can exceed MAX_VALUE
	(value) =>
		/^[+-]?\d+$/.test(value) &&
		(value.length < 309 || Number.isInteger(+value)),
	Integer,
	() =>
		pureRefine(
			Refine(
				NumberType(),
				(value) => Number.isInteger(value),
				() => 'must be integer'
			)
		)
)

export const IntegerString = (
	property?: TNumberOptions
): Readonly<IntegerStringSchema> =>
	integerString(property) as IntegerStringSchema
