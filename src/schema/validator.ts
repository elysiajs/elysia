import type { Static, StaticDecode, StaticEncode, TAny, TSchema } from 'typebox'
import {
	Compile,
	IsDefault,
	type Validator as BaseTypeBoxValidator
} from 'typebox/schema'
import {
	Assert,
	Clean,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	Errors,
	HasCodec,
	Pipeline
} from 'typebox/value'
import type { TLocalizedValidationError } from 'typebox/error'

import { createMirror } from 'exact-mirror'

import { isBlob, t } from '../type'
import { applyCoercions, type CoerceOption } from './coerce'
import type {
	AnySchema,
	ElysiaConfig,
	MaybePromise,
	StandardSchemaV1Like
} from '../types'
import { isAsyncFunction } from '../compile/utils'
import { hasProperty } from './utils'

export interface ValidatorOptions {
	schemas?: AnySchema[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any>['sanitize']
}

export interface ResponseValidatorOptions extends Omit<
	ValidatorOptions,
	'schemas'
> {
	schemas?: Record<number, AnySchema>[]
}

export type ToSubTypeValidator<T> = T extends AnySchema
	? T extends TSchema
		? TypeBoxValidator<T>
		: StandardValidator
	: never

export abstract class Validator {
	abstract Check(value: unknown): boolean
	abstract Errors(value: unknown): TLocalizedValidationError[]

	Decode(value: unknown): unknown {
		return value
	}

	Encode(value: unknown): unknown {
		return value
	}

	From?(
		value: unknown,
		error: (value: unknown) => MaybePromise<void>
	): unknown

	Clean: ((value: unknown) => unknown) | undefined

	static create<const Schema extends TSchema>(
		schema: Schema,
		options?: ValidatorOptions
	): TypeBoxValidator<Schema>

	static create<const Schema extends StandardSchemaV1Like>(
		schema: Schema,
		options?: ValidatorOptions
	): StandardValidator

	static create(schema: AnySchema, options?: ValidatorOptions) {
		if (options?.schemas?.length) {
			if (
				'~kind' in schema &&
				options.schemas.every((v) => '~kind' in v || '~elyAcl' in v)
			)
				schema = t.Evaluate(
					t.Intersect([schema as TSchema, ...options.schemas])
				) as AnySchema
			else return new MultiValidator(schema, options) as any
		}

		if ('~kind' in schema || '~elyAcl' in schema) {
			if (tbCache) {
				const cached = tbCache.get(schema, options?.coerces)
				if (cached) return cached
			} else tbCache = new TypeBoxValidatorCache()

			const validator = new TypeBoxValidator(schema, options) as any
			tbCache.set(schema, options?.coerces, validator)

			return validator
		}

		if ('~standard' in schema) return new StandardValidator(schema) as any

		throw new Error(
			'Elysia Validator support only TypeBox and Standard Schema'
		)
	}

	static response = (
		schema: Record<number, TSchema | StandardSchemaV1Like>,
		options?: ResponseValidatorOptions
	): Record<number, Validator> =>
		Object.fromEntries(
			Object.entries(schema).map(([k, v]) => [
				k,
				v instanceof Validator
					? v
					: Validator.create(v, {
							normalize: options?.normalize,
							sanitize: options?.sanitize,
							coerces: options?.coerces,
							schemas: options?.schemas?.map(
								(s) => s[k as unknown as keyof typeof s]
							)
						})
			])
		)
}

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

		if (this.isAsync)
			// @ts-expect-error
			this.From = async (value: unknown) => {
				if (this.hasDefault)
					value = Default(this.schema, value) as Static<T>
				if (this.hasCodec)
					value = (await Decoder(this.schema, value)) as Static<T>
				// @ts-expect-error
				if (!(await this.Check(value))) throw this.Errors(value)
				if (this.Clean) value = this.Clean(value) as Static<T>

				return value
			}

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

	// Do not convert to arrow function
	// otherwise memory usage will increase drastically somehow
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

	From(value: Static<T>): StaticDecode<T> {
		if (this.hasDefault) value = Default(this.schema, value) as Static<T>
		if (this.hasCodec) value = Decoder(this.schema, value) as Static<T>
		if (!this.Check(value)) throw this.Errors(value)
		if (this.Clean) value = this.Clean(value) as Static<T>

		return value as StaticDecode<T>
	}
}

export class StandardValidator extends Validator {
	private validate: (
		value: unknown
	) => { value: unknown } | { issues: unknown[] }

	constructor(schema: StandardSchemaV1Like) {
		super()
		// @ts-expect-error
		this.validate = schema['~standard'].validate
	}

	Check(value: unknown): boolean {
		return 'value' in this.validate(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		// @ts-expect-error
		return this.validate(value).issues ?? []
	}

	Decode(value: unknown): unknown {
		// @ts-expect-error
		return this.validate(value).value
	}

	From(value: unknown): unknown {
		const q = this.validate(value)
		// @ts-expect-error
		if (q.issues) throw this.Errors(value)

		// @ts-expect-error
		return q.value
	}
}

export class MultiValidator extends Validator {
	private schemas: (TSchema | StandardSchemaV1Like)[]
	private codexIndexes: Set<number>

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options: ValidatorOptions
	) {
		super()

		let typeboxObjects
		const schemas = [schema].concat(options.schemas!)
		const codexIndexes = new Set<number>()

		for (let i = 0; i < schemas.length; i++) {
			const schema = schemas[i]
			const isTypeBox = '~kind' in schema

			if (!isTypeBox && !('~standard' in schema))
				throw new Error(
					'Elysia Validator support only TypeBox and Standard Schema'
				)

			if (isTypeBox) {
				if (HasCodec(schema)) codexIndexes.add(i)

				if (schema['~kind'] === 'Object') {
					typeboxObjects ??= []
					typeboxObjects.push(schema as TSchema)
					schemas.splice(i, 1)
					i--
				} else
					schemas[i] = Compile(
						applyCoercions(schema, options?.coerces)
					)
			}
		}

		if (typeboxObjects)
			schemas.push(
				Compile(
					applyCoercions(
						t.Evaluate(t.Intersect(typeboxObjects)),
						options?.coerces
					)
				)
			)

		this.schemas = schemas
		this.codexIndexes = codexIndexes
	}

	Check(value: unknown): boolean {
		return this.schemas.every((validator) =>
			'~standard' in validator
				? // @ts-expect-error
					validator['~standard'].validate(value).value
				: (validator as TypeBoxValidator).Decode(value) || true
		)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const errors: TLocalizedValidationError[] = []

		for (const schema of this.schemas)
			if ('~standard' in schema) {
				// @ts-expect-error
				const issues = schema['~standard'].validate(value).issues
				if (issues) errors.push(...issues)
			} else
				errors.push(
					...Errors((schema as BaseTypeBoxValidator).Schema(), value)
				)

		return errors
	}

	Decode(value: unknown): unknown {
		let snapshot: Record<string, unknown> | unknown[]

		for (let i = 0; i < this.schemas.length; i++) {
			const validator = this.schemas[i]

			const result =
				'~standard' in validator
					? // @ts-expect-error
						validator['~standard'].validate(value).value
					: this.codexIndexes.has(i)
						? Decode(validator as TypeBoxValidator, value)
						: value

			if (snapshot! === undefined) snapshot = result
			else if (typeof snapshot === 'object' && typeof result === 'object')
				snapshot = Object.assign(snapshot, result)
			else if (Array.isArray(snapshot) && Array.isArray(result))
				snapshot.push(...result)
			else throw new Error('Unable to merged value with different type')
		}

		return snapshot!
	}

	From(value: unknown, error: (value: unknown) => void): unknown {
		if (!this.Check(value)) return void error(value)

		return this.Decode(value)!
	}
}

class TypeBoxValidatorCache {
	static EMPTY = {} as const

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

		const key = JSON.stringify(schema)
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
		const key = JSON.stringify(schema)
		if (this.cache.has(key)) {
			const cache = this.cache.get(key)!.set(coercions, validator)

			if (this.referenceCache.has(schema))
				this.referenceCache.get(schema)!.set(coercions, validator)
			else this.referenceCache.set(schema, cache)
		}

		const cache = new WeakMap().set(coercions, validator)

		this.cache.set(key, cache)
		this.referenceCache.set(schema, cache)
	}

	clear() {}
}

let tbCache: TypeBoxValidatorCache
