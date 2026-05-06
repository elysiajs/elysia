import { useTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Decode, Errors } from 'typebox/value'

import { applyCoercions } from './coerce'
import { TypeBoxValidator, TypeBoxValidatorCache } from './validator'

import { hasTypes } from './utils'
import {
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure
} from './coerce'

let setup = false
export function setupTypebox() {
	if (setup) return

	setup = true
	useTypebox({
		Compile,
		Decode,
		Errors,
		applyCoercions,
		TypeBoxValidator: TypeBoxValidator as any,
		TypeBoxValidatorCache: TypeBoxValidatorCache as any,
		coerceFormData,
		coerceQuery,
		coerceRoot,
		coerceStringToStructure,
		hasTypes
	})
}
