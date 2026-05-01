import { useTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Decode, Errors } from 'typebox/value'

import { applyCoercions } from './coerce'
import { TypeBoxValidator, TypeBoxValidatorCache } from './validator'

import {
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure
} from './coerce'

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
	coerceStringToStructure
})
