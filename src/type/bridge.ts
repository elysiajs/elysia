import type { TAny, TSchema, Ref as RefType } from 'typebox/type'
import type { Compile as CompileType } from 'typebox/compile'
import type {
	Create as CreateType,
	Decode as DecodeType,
	HasCodec as HasCodecType,
	Default as DefaultType,
	Clone as CloneType,
	Check as CheckType
} from 'typebox/value'

import type { applyCoercions as applyCoercionsType } from './coerce'
import type {
	TypeBoxValidator as TypeBoxValidatorType,
	TypeBoxValidatorCache as TypeBoxValidatorCacheType,
	mayHaveFileType as mayHaveFileTypeType
} from './validator'

import type { Intersect as IntersectType } from './elysia/intersect'
import type {
	coerceFormData as coerceFormDataType,
	coerceQuery as coerceQueryType,
	coerceRoot as coerceRootType,
	coerceStringToStructure as coerceStringToStructureType,
	coerceBody as coerceBodyType
} from './coerce'
import type { hasTypes as hasTypesType } from './utils'

interface TypeboxModule {
	Compile: typeof CompileType
	Create: typeof CreateType
	Decode: typeof DecodeType
	applyCoercions: typeof applyCoercionsType
	TypeBoxValidator: TypeBoxValidatorType
	TypeBoxValidatorCache: TypeBoxValidatorCacheType
	coerceFormData: typeof coerceFormDataType
	coerceQuery: typeof coerceQueryType
	coerceRoot: typeof coerceRootType
	coerceStringToStructure: typeof coerceStringToStructureType
	coerceBody: typeof coerceBodyType
	hasTypes: typeof hasTypesType
	mayHaveFileType: typeof mayHaveFileTypeType
	HasCodec: typeof HasCodecType
	Intersect: typeof IntersectType
	Default: typeof DefaultType
	Ref: typeof RefType
	Clone: typeof CloneType
	Check: typeof CheckType
}

let live: TypeboxModule | undefined

function ensure() {
	if (!live)
		throw new Error(
			"Typebox module isn't initialized yet. Import `t` from 'elysia' so the TypeBox bridge can register before TypeBox schemas are used."
		)

	return live
}

function stub(name: keyof TypeboxModule) {
	return function (...args: unknown[]) {
		return (ensure()[name] as Function)(...args)
	} as any
}

function stubClass(name: keyof TypeboxModule) {
	return class {
		constructor(...args: unknown[]) {
			return new (ensure()[name] as unknown as new (
				...args: unknown[]
			) => object)(...args)
		}
	} as any
}

export let Compile: typeof CompileType = stub('Compile')
export let Create: typeof CreateType = stub('Create')
export let Decode: typeof DecodeType = stub('Decode')

export let applyCoercions: typeof applyCoercionsType = stub('applyCoercions')

export let TypeBoxValidator: TypeBoxValidatorType =
	stubClass('TypeBoxValidator')
export type TypeBoxValidator<T extends TSchema = TAny> = TypeBoxValidatorType<T>

export let TypeBoxValidatorCache: TypeBoxValidatorCacheType = stubClass(
	'TypeBoxValidatorCache'
)
export type TypeBoxValidatorCache = TypeBoxValidatorCacheType

export let coerceFormData: typeof coerceFormDataType = stub('coerceFormData')
export let coerceQuery: typeof coerceQueryType = stub('coerceQuery')
export let coerceRoot: typeof coerceRootType = stub('coerceRoot')
export let coerceStringToStructure: typeof coerceStringToStructureType = stub(
	'coerceStringToStructure'
)
export let coerceBody: typeof coerceBodyType = stub('coerceBody')

export let hasTypes: typeof hasTypesType = stub('hasTypes')
export let mayHaveFileType: typeof mayHaveFileTypeType = stub('mayHaveFileType')
export let HasCodec: typeof HasCodecType = stub('HasCodec')

export let Intersect: typeof IntersectType = stub('Intersect')
export let Default: typeof DefaultType = stub('Default')

export let Ref: typeof RefType = stub('Ref')

export let Clone: typeof CloneType = stub('Clone')

export let Check: typeof CheckType = stub('Check')

export const isBridgeLive = () => live !== undefined

export function useTypebox(mod: TypeboxModule) {
	live = mod

	Compile = mod.Compile
	Create = mod.Create
	Decode = mod.Decode
	applyCoercions = mod.applyCoercions
	TypeBoxValidator = mod.TypeBoxValidator
	TypeBoxValidatorCache = mod.TypeBoxValidatorCache
	coerceFormData = mod.coerceFormData
	coerceQuery = mod.coerceQuery
	coerceRoot = mod.coerceRoot
	coerceStringToStructure = mod.coerceStringToStructure
	coerceBody = mod.coerceBody
	hasTypes = mod.hasTypes
	mayHaveFileType = mod.mayHaveFileType
	HasCodec = mod.HasCodec
	Intersect = mod.Intersect
	Default = mod.Default
	Ref = mod.Ref
	Clone = mod.Clone
	Check = mod.Check
}
