import type { useTypebox as bridgeUseTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Ref } from 'typebox/type'
import { Create, Decode, HasCodec, Default, Clone } from 'typebox/value'
import { Settings } from 'typebox/system'

import { applyCoercions } from './coerce'
import { TypeBoxValidator, TypeBoxValidatorCache } from './validator'

import { Intersect } from './elysia/intersect'
import {
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure,
	coerceBody
} from './coerce'
import { hasTypes } from './utils'

Settings.Set({ unionPrioritySort: false })

export function useTypebox(_mod?: Parameters<typeof bridgeUseTypebox>[0]) {}

export const isBridgeLive = () => true

export {
	Compile,
	Create,
	Decode,
	applyCoercions,
	TypeBoxValidator,
	TypeBoxValidatorCache,
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure,
	coerceBody,
	hasTypes,
	HasCodec,
	Intersect,
	Default,
	Ref,
	Clone
}
