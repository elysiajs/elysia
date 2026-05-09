import { Type } from 'typebox'
import { Compile, type Validator as BaseTypeBoxValidator } from 'typebox/schema'
import type {
	Static,
	StaticDecode,
	StaticEncode,
	TAny,
	TSchema
} from 'typebox/type'
import {
	Clean,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	Errors,
	HasCodec,
	Pipeline
} from 'typebox/value'
import { TLocalizedValidationError } from 'typebox/error'

import createMirror from 'exact-mirror'

import { applyCoercions, deferCoercions, type CoerceOption } from './coerce'
import { Validator, type ValidatorOptions } from '../validator'
import { isAsyncFunction } from '../compile/utils'
import { hasProperty } from './utils'
import { isBlob } from '../utils'
import { ValidationError } from '../error'

import type { MaybePromise } from '../types'

const Decoder = Pipeline([
	(context, type, value) => DecodeUnsafe(context, type, value)
])

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x) =>
				typeof x.refine === 'function'
					? isAsyncFunction(x.refine) || x.refine === isBlob
					: false
			)
		: false

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	tb: BaseTypeBoxValidator
	hasCodec: boolean
	schema: T
	isAsync: boolean
	hasDefault: boolean

	constructor(
		schema: T,
		options?: ValidatorOptions,
		name?: string,
		isIntersectable?: boolean
	) {
		super()

		if (isIntersectable)
			schema = Type.Evaluate(
				Type.Intersect([schema, ...options!.schemas!])
			)

		if (name && options?.models) {
			const module = moduleCache.getOrInsertComputed(options.models, () =>
				Type.Module(options.models as Record<string, TSchema>)
			)

			schema = module[name] as T
		}

		this.schema = applyCoercions(schema, options?.coerces) as T

		this.tb = Compile(this.schema as TSchema)
		this.hasCodec = HasCodec(this.schema)
		this.isAsync =
			// @ts-expect-error private property
			this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
			false
		this.hasDefault = hasProperty('default', this.schema as any)

		try {
			this.Clean =
				!options?.normalize || options.normalize === 'exactMirror'
					? (createMirror(schema, {
							Compile,
							sanitize: options?.sanitize
						}) as any)
					: options.normalize === 'typebox'
						? (value) => Clean(this.tb!, value)
						: undefined
		} catch (error) {
			console.warn(
				'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
			)
			console.warn(schema)
			console.warn(error)
		}
	}

	Check(value: Static<T>): boolean {
		return this.tb.Check(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return Errors(this.schema, value)
	}

	Decode(value: Static<T>): StaticDecode<T> {
		return Decode(this.schema, value)
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return this.hasCodec ? Encode(this.schema, value) : (value as any)
	}

	From(value: Static<T>, type?: string): MaybePromise<Static<T>> {
		return this.isAsync
			? (this.FromAsync(value, type) as any)
			: this.FromSync(value, type)
	}

	async FromAsync(value: Static<T>, type?: string): Promise<Static<T>> {
		if (this.hasDefault) value = Default(this.schema, value) as any
		// @ts-ignore
		if (this.hasCodec) value = await Decoder(this.schema, value)
		// @ts-ignore
		if (!(await this.Check(value)))
			throw new ValidationError(type, value, this.Errors(value))
		// @ts-ignore
		if (this.Clean) value = this.Clean(value)

		return value
	}

	FromSync(value: Static<T>, type?: string): Static<T> {
		if (this.hasDefault) value = Default(this.schema, value) as Static<T>
		if (this.hasCodec) value = Decoder(this.schema, value) as Static<T>
		if (!this.Check(value))
			throw new ValidationError(type, value, this.Errors(value))
		if (this.Clean) value = this.Clean(value) as Static<T>
		return value
	}
}

export class TypeBoxValidatorCache {
	private static EMPTY = {} as const
	private static ignoreKeys = new Set([
		'title',
		'description',
		'tags',
		'examples',
		'error',
		'defaultValue'
	])

	static ignoreMeta(k: string, v: unknown) {
		// `replacer` must return the value to keep it; returning undefined
		// drops the property. Previously this only checked the key and fell
		// off the end (returning undefined) for every property — collapsing
		// every schema to the same cache key.
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return undefined
		return v
	}

	private cache = new Map<
		string,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()
	private referenceCache = new WeakMap<
		TSchema,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY
	) {
		if (this.referenceCache.has(schema)) {
			const coercionsCache = this.referenceCache.get(schema)!
			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)!
		}

		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.cache.has(key)) {
			const coercionsCache = this.cache.get(key)!

			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)!
		}
	}

	set(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		validator: BaseTypeBoxValidator
	) {
		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.cache.has(key)) {
			const cache = this.cache.get(key)!.set(coercions, validator)

			if (this.referenceCache.has(schema))
				this.referenceCache.get(schema)!.set(coercions, validator)
			else this.referenceCache.set(schema, cache)

			return
		}

		const cache = new WeakMap().set(coercions, validator)

		this.cache.set(key, cache)
		this.referenceCache.set(schema, cache)
	}

	clear() {
		this.cache.clear()
		this.referenceCache = new WeakMap()
		deferCoercions()
		tbCache = undefined
	}
}

let tbCache: TypeBoxValidatorCache | undefined
