import { useTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Ref } from 'typebox/type'
import { Decode, Errors, HasCodec, Default } from 'typebox/value'

import * as TypeRegistry from './exports'

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
		coerceBody,
		hasTypes,
		HasCodec,
		Intersect,
		Default,
		Ref,
		TypeRegistry
	})
}
