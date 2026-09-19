import { useTypebox } from './bridge'

import {
	Ref,
	injectTypeboxType,
	type TypeboxTypeNamespaces
} from './typebox-type'
import {
	Compile,
	Create,
	Decode,
	HasCodec,
	Default,
	Clone,
	Check,
	injectTypebox,
	warmTypebox,
	type TypeboxNamespaces
} from './typebox-value'

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
import { setExactMirror, type CreateMirror } from './validator/exact-mirror'

let setup = false
export function setupTypebox(options?: {
	exactMirror?: CreateMirror
	typebox?: Partial<TypeboxNamespaces & TypeboxTypeNamespaces>
}) {
	if (options?.exactMirror) setExactMirror(options.exactMirror)

	const typebox = options?.typebox
	if (typebox) {
		const typeSide = [typebox.type, typebox.system] as const
		const typeSideProvided = typeSide.filter(Boolean).length
		if (typeSideProvided > 0 && typeSideProvided < typeSide.length)
			throw new Error(
				`setupTypebox({ typebox }) received an incomplete type-side namespace (only '${typebox.type ? 'type' : 'system'}' was set). 'type' and 'system' must be provided together.`
			)

		const valueSide = [
			typebox.value,
			typebox.schema,
			typebox.compile
		] as const
		const valueSideProvided = valueSide.filter(Boolean).length
		if (valueSideProvided > 0 && valueSideProvided < valueSide.length) {
			const missing = (['value', 'schema', 'compile'] as const).filter(
				(key) => !typebox[key]
			)

			throw new Error(
				`setupTypebox({ typebox }) received an incomplete value-side namespace (missing '${missing.join("', '")}'). 'value', 'schema', and 'compile' must be provided together.`
			)
		}

		// Type side first: the value side ensures the `Settings` default
		// through the type leaf, which would otherwise try to `require` it
		if (typebox.type && typebox.system)
			injectTypeboxType(typebox as TypeboxTypeNamespaces)

		if (typebox.value && typebox.schema && typebox.compile)
			injectTypebox(typebox as TypeboxNamespaces)
	}

	if (setup) return

	setup = true

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
		Check,
		warmTypebox
	})
}

/**
 * Never called — it exists purely so module-graph tracers can see the
 * `typebox` and `exact-mirror` specifiers.
 *
 * Both packages are loaded through
 * `process.getBuiltinModule('module').createRequire(...)` in `./typebox-type`,
 * `./typebox-value` and `./validator/exact-mirror`, which keeps them off the
 * startup path. Every static analyser treats that call as opaque, so nothing
 * links either package into the module graph: on Vercel `@vercel/nft` never
 * copies them into the serverless bundle and the deploy dies with
 * `Cannot find module 'typebox/type'` (#1973).
 *
 * Naming them in a never-awaited `import()` is enough for tracers to follow.
 * It lives here, unused and unreferenced, so that bundlers still tree-shake it
 * out of application bundles and the AOT `compat` stub drops it wholesale —
 * neither TypeBox nor exact-mirror is pulled into a sealed build. `typebox/type`
 * stands in for the whole package; tracers copy it entry by entry
 */
// I have nothing but my burger and I want nothing more
export const traceOptionalDependencies = () =>
	Promise.all([import('typebox/type'), import('exact-mirror')])
