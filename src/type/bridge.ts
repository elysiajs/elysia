import type { TAny, TSchema } from 'typebox/type'
import type { Compile as CompileType } from 'typebox/compile'
import type {
	Decode as DecodeType,
	Errors as ErrorsType,
	HasCodec as HasCodecType,
	Default as DefaultType
} from 'typebox/value'

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

import type { CheckContext as CheckContextType } from 'typebox/schema'
import type { Guard as GuardType } from 'typebox/guard'
import type { Format as FormatType } from 'typebox/format'
import type { Hashing as HashingType } from 'typebox/system'

const error = new Error("Typebox module isn't initialized yet")
function errorFn() {
	throw error
}
class Noop {
	constructor() {
		throw error
	}
}

export let Compile: typeof CompileType = errorFn as any
export let Decode: typeof DecodeType = errorFn as any
export let Errors: typeof ErrorsType = errorFn as any

export let applyCoercions: typeof applyCoercionsType = errorFn as any

export let TypeBoxValidator: TypeBoxValidatorType = Noop as any
export type TypeBoxValidator<T extends TSchema = TAny> = TypeBoxValidatorType<T>

export let TypeBoxValidatorCache: TypeBoxValidatorCacheType = Noop as any
export type TypeBoxValidatorCache = TypeBoxValidatorCacheType

export let coerceFormData: typeof coerceFormDataType = errorFn as any
export let coerceQuery: typeof coerceQueryType = errorFn as any
export let coerceRoot: typeof coerceRootType = errorFn as any
export let coerceStringToStructure: typeof coerceStringToStructureType =
	errorFn as any
export let coerceBody: typeof coerceBodyType = errorFn as any

export let hasTypes: typeof hasTypesType = errorFn as any
export let HasCodec: typeof HasCodecType = errorFn as any

export let Intersect: typeof IntersectType = errorFn as any
export let Default: typeof DefaultType = errorFn as any

export let CheckContext: typeof CheckContextType = errorFn as any
export let Guard: typeof GuardType = errorFn as any
export let Format: typeof FormatType = errorFn as any
export let Hashing: typeof HashingType = errorFn as any

export function useTypebox(mod: {
	Compile: typeof CompileType
	Decode: typeof DecodeType
	Errors: typeof ErrorsType
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
	CheckContext: typeof CheckContext
	Guard: typeof Guard
	Format: typeof Format
	Hashing: typeof Hashing
}) {
	Compile = mod.Compile
	Decode = mod.Decode
	Errors = mod.Errors
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
	CheckContext = mod.CheckContext
	Guard = mod.Guard
	Format = mod.Format
	Hashing = mod.Hashing
}
