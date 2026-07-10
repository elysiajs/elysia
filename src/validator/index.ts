import type { TSchema } from 'typebox/type'
import type { TLocalizedValidationError } from 'typebox/error'
import type { Validator as CompiledTypeBoxValidator } from 'typebox/compile'

import { ValidationError } from '../error'
import { type AnySchema, type StandardSchemaV1Like } from '../type'

import type { ElysiaConfig, MaybePromise } from '../types'
import type { CoerceOption } from '../type/coerce'
import { clearCoerceLeafCache, nonAdditionalProperties } from '../type/coerce'
import { Compiled, Capture, type ValidatorSlot } from '../compile/aot'

import {
	Clone,
	Compile,
	applyCoercions,
	TypeBoxValidator,
	TypeBoxValidatorCache,
	Intersect,
	HasCodec,
	Default
} from '../type/bridge'
import { isAsyncFunction } from '../compile/utils'
import { ASYNC_REFINE } from '../type/elysia/file-type'
import { clearSharedReferenceCaches } from '../type/elysia/utils'
import { hasProperty } from '../type/utils'

export interface ValidatorOptions {
	models?: Record<keyof any, AnySchema>
	schemas?: AnySchema[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any, any>['sanitize']
	aot?: { method: string; path: string }
	slot?: ValidatorSlot
}

export interface ResponseValidatorOptions
	extends Omit<ValidatorOptions, 'schemas'> {
	schemas?: Record<number, AnySchema>[]
}

export type ToSubTypeValidator<T> = T extends AnySchema
	? T extends TSchema
		? TypeBoxValidator<T>
		: StandardValidator
	: never

export abstract class Validator {
	isAsync: boolean = true
	mayReturnPromise = false

	abstract Check(value: unknown): boolean
	abstract Errors(value: unknown): TLocalizedValidationError[]

	static reference(
		schema: string | TSchema | StandardSchemaV1Like,
		models: Record<keyof any, AnySchema> | undefined
	): AnySchema {
		if (typeof schema !== 'string') return schema as unknown as AnySchema
		if (models && schema in models) return models[schema]

		throw new Error(`Schema reference "${schema}" not found in models`)
	}

	Decode(value: unknown): unknown {
		return value
	}

	Encode(value: unknown): unknown {
		return value
	}

	From?(
		value: unknown,
		type?: string,
		allowAsync?: boolean
	): MaybePromise<unknown>

	Clean: ((value: unknown) => unknown) | undefined

	static create<const Schema extends TSchema>(
		schema: Schema,
		options?: ValidatorOptions
	): TypeBoxValidator<Schema>

	static create<const Schema extends StandardSchemaV1Like>(
		schema: Schema,
		options?: ValidatorOptions
	): StandardValidator

	static create(
		schema: undefined | null,
		options?: ValidatorOptions
	): Validator | undefined

	static create(
		name: AnySchema | string | undefined | null,
		options?: ValidatorOptions
	) {
		if (name == null) {
			if (!options?.schemas?.length) return

			name = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		const schema = Validator.reference(name, options?.models)

		if (options?.schemas?.some((v) => typeof v === 'string')) {
			const models = options.models
			options = {
				...options,
				schemas: options.schemas.map((v) =>
					Validator.reference(v as any, models)
				)
			}
		}

		if (isCompiledSchema(schema)) {
			const message =
				'[Elysia] Compiled schema detected. Please pass t.Schema instead.'

			if (Capture.isCapturing())
				throw new Error(
					`${message} build plugin cannot serialize a pre-compiled schema.`
				)

			console.warn(message)
		}

		let isIntersectable = false

		if (options?.schemas?.length) {
			if (
				'~kind' in schema &&
				options.schemas.every((v) => '~kind' in v || '~elyAcl' in v)
			)
				isIntersectable = true
			else return new MultiValidator(schema, options) as any
		}

		if ('~kind' in schema || '~elyAcl' in schema) {
			const skipCache =
				options?.normalize === false || !!options?.sanitize
			const aot = options?.aot
			const slot = options?.slot

			const normalizeKey =
				options?.normalize === 'typebox' ? 'typebox' : ''

			const bypassCache =
				!!aot &&
				!!slot &&
				(Capture.isCapturing() ||
					(options?.normalize !== 'typebox' &&
						// lazy-aware: checks existence without materializing the group
						Compiled.hasValidator(aot.method, aot.path, slot)))

			if (!isIntersectable && !skipCache && !bypassCache && tbCache) {
				const cached = tbCache.get(
					schema,
					options?.coerces,
					normalizeKey,
					options?.models
				)
				if (cached) return cached
			}
			// @ts-expect-error
			else if (!tbCache) tbCache = new TypeBoxValidatorCache()

			// @ts-expect-error
			const validator = new TypeBoxValidator(
				schema,
				options,
				typeof name === 'string' ? name : undefined,
				isIntersectable
			) as any

			if (!isIntersectable && !skipCache && !bypassCache)
				tbCache!.set(
					schema,
					options?.coerces,
					validator,
					normalizeKey,
					options?.models
				)
			return validator
		}

		if ('~standard' in schema) {
			return new StandardValidator(schema) as any
		}

		throw new Error(
			'Elysia Validator support only TypeBox and Standard Schema'
		)
	}

	static response(
		schema:
			| TSchema
			| StandardSchemaV1Like
			| Record<number, TSchema | StandardSchemaV1Like>
			| undefined
			| null,
		options?: ResponseValidatorOptions
	): Record<number, Validator> | undefined {
		if (schema == null) {
			if (!options?.schemas?.length) return

			schema = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		schema = Validator.reference(schema, options?.models)

		const responseSlot = (status: number | string) =>
			options?.aot ? (`response:${status}` as ValidatorSlot) : undefined

		if (isSingleSchema(schema))
			return {
				200: Validator.create(
					schema as TSchema | StandardSchemaV1Like,
					{
						...options,
						slot: responseSlot(200),
						schemas: options?.schemas
							?.map((s) => toStatusBased(s)[200])
							?.filter(Boolean)
					}
				)
			}

		const entries = Object.entries(schema)

		return Object.fromEntries(
			entries.map(([k, v]) => [
				k,
				v instanceof Validator
					? v
					: Validator.create(v, {
							...options,
							slot: responseSlot(k),
							schemas: options?.schemas
								?.map((s) => toStatusBased(s)[k as any])
								?.filter(Boolean)
						})
			])
		)
	}

	static clear() {
		tbCache?.clear()
		clearCoerceLeafCache()
		clearSharedReferenceCaches()
	}
}

const isCompiledSchema = (schema: any) =>
	schema != null &&
	typeof schema.Check === 'function' &&
	'buildResult' in schema

// a single TypeBox / Standard / Acl schema vs a `Record<status, schema>` map
const isSingleSchema = (schema: any): boolean =>
	'~kind' in schema || '~elyAcl' in schema || '~standard' in schema

const toStatusBased = (
	schema:
		| TSchema
		| StandardSchemaV1Like
		| Record<number, TSchema | StandardSchemaV1Like>
): Record<number, AnySchema> =>
	isSingleSchema(schema)
		? { 200: schema as unknown as AnySchema }
		: (schema as Record<number, AnySchema>)

const isAsyncStandardSchema = (schema: StandardSchemaV1Like) =>
	isAsyncFunction((schema['~standard'] as any).validate)

const asyncStandardSchemaError = () =>
	new Error(
		'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'
	)

export class StandardValidator extends Validator {
	override mayReturnPromise = true

	#validate: (
		value: unknown
	) =>
		| { value: unknown }
		| { issues: unknown[] }
		| Promise<{ value: unknown } | { issues: unknown[] }>

	constructor(schema: StandardSchemaV1Like) {
		super()

		// @ts-expect-error
		this.#validate = schema['~standard'].validate
		this.isAsync = isAsyncStandardSchema(schema)
	}

	#sync(value: unknown) {
		const q = this.#validate(value)

		if (q instanceof Promise) throw asyncStandardSchemaError()

		return q
	}

	Check(value: unknown): boolean {
		return 'value' in this.#sync(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		// @ts-expect-error
		return this.#sync(value).issues ?? []
	}

	Decode(value: unknown): unknown {
		// @ts-expect-error
		return this.#sync(value).value
	}

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	From(value: unknown, type?: string, allowAsync = this.isAsync): unknown {
		const q = this.#validate(value)

		if (q instanceof Promise) {
			if (!allowAsync) throw asyncStandardSchemaError()

			return q.then((resolved) => {
				if ('issues' in resolved)
					throw new ValidationError(type, value, resolved.issues)

				return resolved.value
			})
		}

		// @ts-expect-error
		if (q.issues) throw new ValidationError(type, value, q.issues)

		// @ts-expect-error
		return q.value
	}
}

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x: any) =>
				typeof x.check === 'function'
					? isAsyncFunction(x.check) || x.check[ASYNC_REFINE] === true
					: false
			)
		: false

export class MultiValidator extends Validator {
	override isAsync = false

	#schemas: (CompiledTypeBoxValidator | StandardSchemaV1Like)[]
	#codecs: boolean[]
	#hasDefaults: boolean[]
	#tbSchemas: (TSchema | null)[]
	#asyncMembers: (TypeBoxValidator | null)[]

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options: ValidatorOptions
	) {
		super()

		let typeboxObjects: TSchema[] | undefined
		const schemas = [schema].concat(options.schemas!) as (
			| TSchema
			| StandardSchemaV1Like
			| CompiledTypeBoxValidator
		)[]

		const codecs: boolean[] = []
		const hasDefaults: boolean[] = []
		const tbSchemas: (TSchema | null)[] = []
		const asyncMembers: (TypeBoxValidator | null)[] = []

		const shouldClose = options?.normalize === false

		for (let i = 0; i < schemas.length; i++) {
			const schema = schemas[i]
			const isTypeBox = '~kind' in schema

			if (!isTypeBox && !('~standard' in schema))
				throw new Error(
					'Elysia Validator support only TypeBox and Standard Schema'
				)

			if (isTypeBox) {
				if (schema['~kind'] === 'Object') {
					typeboxObjects ??= []
					typeboxObjects.push(schema as TSchema)
					schemas.splice(i, 1)
					i--
				} else {
					const rawSchema = schema as TSchema
					let coercedSchema = applyCoercions(
						rawSchema,
						options?.coerces
					)
					if (shouldClose)
						coercedSchema = nonAdditionalProperties(
							coercedSchema as any
						) as TSchema

					const compiled = Compile(coercedSchema)
					schemas[i] = compiled as any

					codecs.push(HasCodec(coercedSchema))

					const hd = hasProperty('default', rawSchema)
					hasDefaults.push(hd)
					tbSchemas.push(hd ? coercedSchema : null)

					const isAsync =
						(
							compiled as any
						).buildResult?.external?.variables?.some(
							isAsyncPredicate
						) ?? false
					if (isAsync) {
						this.isAsync = true

						asyncMembers.push(
							Validator.create(rawSchema, {
								coerces: options?.coerces,
								normalize: options?.normalize,
								models: options?.models,
								sanitize: options?.sanitize
							})! as unknown as TypeBoxValidator
						)
					} else asyncMembers.push(null)
				}
			} else {
				this.mayReturnPromise = true
				if (isAsyncStandardSchema(schema)) this.isAsync = true
				codecs.push(false)
				hasDefaults.push(false)
				tbSchemas.push(null)
				asyncMembers.push(null)
			}
		}

		if (typeboxObjects) {
			const rawMerged = Intersect(typeboxObjects)
			let coercedMerged = applyCoercions(rawMerged, options?.coerces)

			if (shouldClose)
				coercedMerged = nonAdditionalProperties(
					coercedMerged as any
				) as TSchema

			const compiled = Compile(coercedMerged)
			schemas.push(compiled as any)

			codecs.push(HasCodec(coercedMerged))
			const hd = typeboxObjects.some((s) =>
				hasProperty('default', s as any)
			)
			hasDefaults.push(hd)
			tbSchemas.push(hd ? coercedMerged : null)

			const isAsync =
				(compiled as any).buildResult?.external?.variables?.some(
					isAsyncPredicate
				) ?? false

			if (isAsync) {
				this.isAsync = true
				asyncMembers.push(
					Validator.create(rawMerged as TSchema, {
						coerces: options?.coerces,
						normalize: options?.normalize,
						models: options?.models,
						sanitize: options?.sanitize
					})! as unknown as TypeBoxValidator
				)
			} else asyncMembers.push(null)
		}

		this.#schemas = schemas as (
			| CompiledTypeBoxValidator
			| StandardSchemaV1Like
		)[]
		this.#codecs = codecs
		this.#hasDefaults = hasDefaults
		this.#tbSchemas = tbSchemas
		this.#asyncMembers = asyncMembers
	}

	static #merge(
		snapshot: Record<string, unknown> | unknown[] | undefined,
		result: any
	): Record<string, unknown> | unknown[] {
		if (snapshot === undefined) return result
		if (Array.isArray(snapshot) && Array.isArray(result)) {
			snapshot.push(...result)
			return snapshot
		}

		if (typeof snapshot === 'object' && typeof result === 'object')
			return Object.assign(snapshot, result)

		throw new Error('Unable to merged value with different type')
	}

	static #syncStandard(schema: StandardSchemaV1Like, value: unknown) {
		// @ts-expect-error
		const q = schema['~standard'].validate(value)
		if (q instanceof Promise) throw asyncStandardSchemaError()

		return q
	}

	Check(value: unknown): boolean {
		for (let i = 0; i < this.#schemas.length; i++) {
			const validator = this.#schemas[i]

			if ('~standard' in validator) {
				if (MultiValidator.#syncStandard(validator, value).issues)
					return false
				continue
			}

			const compiled = validator as CompiledTypeBoxValidator

			if (!this.#codecs[i]) {
				if (!compiled.Check(value)) return false
				continue
			}

			try {
				;(compiled as any).Decode(value)
			} catch {
				return false
			}
		}

		return true
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const errors: TLocalizedValidationError[] = []

		for (const schema of this.#schemas)
			if ('~standard' in schema) {
				const issues = MultiValidator.#syncStandard(
					schema,
					value
				).issues
				if (issues) errors.push(...issues)
			} else
				errors.push(
					...(schema as CompiledTypeBoxValidator).Errors(value)
				)

		return errors
	}

	Decode(value: unknown): unknown {
		let snapshot: Record<string, unknown> | unknown[] | undefined

		for (let i = 0; i < this.#schemas.length; i++) {
			const validator = this.#schemas[i]

			snapshot = MultiValidator.#merge(
				snapshot,
				'~standard' in validator
					? MultiValidator.#syncStandard(validator, value).value
					: this.#decodeMember(
							validator as CompiledTypeBoxValidator,
							i,
							value
						)
			)
		}

		return snapshot!
	}

	#decodeMember(
		compiled: CompiledTypeBoxValidator,
		index: number,
		value: unknown
	) {
		const v = this.#cloneForMember(value)

		return this.#codecs[index]
			? (compiled as any).Clean((compiled as any).Decode(v))
			: (compiled as any).Clean(v)
	}

	#cloneForMember(value: unknown) {
		return this.#schemas.length > 1 &&
			value !== null &&
			typeof value === 'object'
			? Clone(value)
			: value
	}

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	#fromTypeBox(
		compiled: CompiledTypeBoxValidator,
		index: number,
		value: unknown,
		type?: string
	): unknown {
		let v = this.#cloneForMember(value)

		if (this.#hasDefaults[index])
			v = (compiled as any).Default
				? (compiled as any).Default(v)
				: Default(this.#tbSchemas[index]!, v)

		if (this.#codecs[index])
			try {
				return (compiled as any).Clean((compiled as any).Decode(v))
			} catch {
				throw new ValidationError(type, value, () =>
					(compiled as CompiledTypeBoxValidator).Errors(value)
				)
			}

		if (!(compiled as CompiledTypeBoxValidator).Check(v))
			throw new ValidationError(type, value, () =>
				(compiled as CompiledTypeBoxValidator).Errors(v)
			)

		return (compiled as any).Clean(v)
	}

	#fromTypeBoxAsync(
		tbv: TypeBoxValidator,
		value: unknown,
		type?: string
	): Promise<unknown> {
		return (tbv as any).FromAsync(this.#cloneForMember(value), type)
	}

	From(
		value: unknown,
		type?: string,
		allowAsync = this.isAsync
	): MaybePromise<unknown> {
		return this.#fromLoop(value, 0, undefined, type, allowAsync)
	}

	#fromLoop(
		value: unknown,
		start: number,
		snapshot: Record<string, unknown> | unknown[] | undefined,
		type?: string,
		allowAsync = this.isAsync
	): MaybePromise<unknown> {
		for (let i = start; i < this.#schemas.length; i++) {
			const validator = this.#schemas[i]

			if ('~standard' in validator) {
				// @ts-expect-error
				const q = validator['~standard'].validate(value)

				if (q instanceof Promise) {
					if (!allowAsync) throw asyncStandardSchemaError()

					// eslint-disable-next-line sonarjs/function-inside-loop
					return q.then((resolved: any) => {
						if (resolved.issues)
							throw new ValidationError(
								type,
								value,
								resolved.issues
							)

						return this.#fromLoop(
							value,
							i + 1,
							MultiValidator.#merge(snapshot, resolved.value),
							type,
							allowAsync
						)
					})
				}

				if (q.issues) throw new ValidationError(type, value, q.issues)

				snapshot = MultiValidator.#merge(snapshot, q.value)
				continue
			}

			const asyncTbv = this.#asyncMembers[i]
			if (asyncTbv) {
				if (!allowAsync) throw asyncStandardSchemaError()

				return this.#fromTypeBoxAsync(asyncTbv, value, type).then(
					// eslint-disable-next-line sonarjs/function-inside-loop
					(result) =>
						this.#fromLoop(
							value,
							i + 1,
							MultiValidator.#merge(snapshot, result),
							type,
							allowAsync
						)
				)
			}

			snapshot = MultiValidator.#merge(
				snapshot,
				this.#fromTypeBox(
					validator as CompiledTypeBoxValidator,
					i,
					value,
					type
				)
			)
		}

		return snapshot!
	}
}

let tbCache: typeof TypeBoxValidatorCache | undefined
