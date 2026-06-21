import { useTypebox } from './bridge'

import { Compile } from 'typebox/compile'
import { Ref } from 'typebox/type'
import { Decode, HasCodec, Default } from 'typebox/value'
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

let setup = false
export function setupTypebox() {
	if (setup) return

	setup = true

	Settings.Set({ unionPrioritySort: false })

	useTypebox({
		// sealed: the only consumers of bridge Compile/Decode/HasCodec are
		// MultiValidator / standalone-guard, which are refused at build time
		// (Capture.unfreezable). Gating these injections drops the typebox/compile
		// import edge (which transitively pulls the entire typebox/value namespace)
		// and the direct typebox/value Decode/HasCodec edges — letting both
		// modules tree-shake out of a sealed bundle.
		Compile: globalThis.ELY_SEALED ? (undefined as any) : Compile,
		Decode: globalThis.ELY_SEALED ? (undefined as any) : Decode,
		applyCoercions,
		TypeBoxValidator: TypeBoxValidator as any,
		TypeBoxValidatorCache: TypeBoxValidatorCache as any,
		coerceFormData,
		coerceQuery,
		coerceRoot,
		coerceStringToStructure,
		coerceBody,
		hasTypes,
		HasCodec: globalThis.ELY_SEALED ? (undefined as any) : HasCodec,
		Intersect,
		// sealed: the only bridge-`Default` consumer (error.ts `expected` hint)
		// is gated off, so this injection — and the typebox/value `Default`
		// import behind it — DCEs out
		Default: globalThis.ELY_SEALED ? (undefined as any) : Default,
		Ref
	})
}
