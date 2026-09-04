import type { useTypebox as bridgeUseTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Ref } from 'typebox/type'
import { Create, Decode, HasCodec, Default, Clone, Check } from 'typebox/value'
import { Settings } from 'typebox/system'

import { applyCoercions } from './coerce'
import {
	TypeBoxValidator,
	TypeBoxValidatorCache,
	mayHaveFileType
} from './validator'

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

// AOT imports TypeBox eagerly.
export function warmTypebox() {}

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
	mayHaveFileType,
	HasCodec,
	Intersect,
	Default,
	Ref,
	Clone,
	Check
}
