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
import { hasProperty } from './utils'

import type { MaybePromise } from '../types'

const Decoder = Pipeline([
	(context, type, value) => DecodeUnsafe(context, type, value)
])

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	tb: BaseTypeBoxValidator
	hasCodec: boolean
	schema: T
	isAsync: boolean
	hasDefault: boolean

	constructor(schema: T, options?: ValidatorOptions) {
		super()

		this.schema = applyCoercions(schema, options?.coerces) as T

		this.tb = Compile(this.schema)
		this.hasCodec = HasCodec(this.schema)
		// @ts-expect-error private property
		this.isAsync = this.tb.build.external.variables.some((array) =>
			// @ts-expect-error private property
			array.some((x) => isAsyncFunction(x.refine) || x.refine === isBlob)
		)
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

	From(value: Static<T>): MaybePromise<Static<T>> {
		return this.isAsync
			? (this.FromAsync(value) as any)
			: this.FromSync(value)
	}

	async FromAsync(value: Static<T>): Promise<Static<T>> {
		if (this.hasDefault) value = Default(this.schema, value) as any
		// @ts-ignore
		if (this.hasCodec) value = await Decoder(this.schema, value)
		// @ts-ignore
		if (!(await this.Check(value))) throw this.Errors(value)
		// @ts-ignore
		if (this.Clean) value = this.Clean(value)

		return value
	}

	FromSync(value: Static<T>): Static<T> {
		if (this.hasDefault) value = Default(this.schema, value) as Static<T>
		if (this.hasCodec) value = Decoder(this.schema, value) as Static<T>
		if (!this.Check(value)) throw this.Errors(value)
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

	static ignoreMeta(k: string) {
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return undefined
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
