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
