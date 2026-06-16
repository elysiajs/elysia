import type { TAny, TSchema, Ref as RefType } from 'typebox/type'
import type { Compile as CompileType } from 'typebox/compile'
import type {
	Decode as DecodeType,
	HasCodec as HasCodecType,
	Default as DefaultType
} from 'typebox/value'

import type * as TypeRegistryType from './exports'

import type { applyCoercions as applyCoercionsType } from './coerce'
import type {
	TypeBoxValidator as TypeBoxValidatorType,
	TypeBoxValidatorCache as TypeBoxValidatorCacheType
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
	HasCodec: typeof HasCodecType
	Intersect: typeof IntersectType
	Default: typeof DefaultType
	Ref: typeof RefType
	TypeRegistry: typeof TypeRegistryType
}

const error = new Error(
	"Typebox module isn't initialized yet. Import `t` from 'elysia' so the TypeBox bridge can register before TypeBox schemas are used."
)

let live: TypeboxModule | undefined

let setupTrigger: (() => void) | undefined
export function setSetupTrigger(fn: () => void) {
	setupTrigger = fn
}

function ensure(): TypeboxModule {
	if (!live) setupTrigger?.()
	if (!live) throw error

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
export let HasCodec: typeof HasCodecType = stub('HasCodec')

export let Intersect: typeof IntersectType = stub('Intersect')
export let Default: typeof DefaultType = stub('Default')

export let Ref: typeof RefType = stub('Ref')

export function ensureTypeRegistry(): typeof TypeRegistryType {
	return ensure().TypeRegistry
}

export function useTypebox(mod: TypeboxModule) {
	live = mod

	Compile = mod.Compile
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
	HasCodec = mod.HasCodec
	Intersect = mod.Intersect
	Default = mod.Default
	Ref = mod.Ref
}
