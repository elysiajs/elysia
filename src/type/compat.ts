import { useTypebox } from './bridge'

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

let setup = false
export function setupTypebox() {
	if (setup) return

	setup = true

	Settings.Set({ unionPrioritySort: false })

	useTypebox({
		Compile,
		Create,
		Decode,
		applyCoercions,
		TypeBoxValidator: TypeBoxValidator as any,
		TypeBoxValidatorCache: TypeBoxValidatorCache as any,
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
	})
}
