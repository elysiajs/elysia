import type { TSchema } from 'typebox/type'
import type { TLocalizedValidationError } from 'typebox/error'
import type { Validator as CompiledTypeBoxValidator } from 'typebox/compile'

import { ValidationError } from '../error'
import { type AnySchema, type StandardSchemaV1Like } from '../type'

import type { ElysiaConfig, MaybePromise } from '../types'
import type { CoerceOption } from '../type/coerce'
import {
	Compiled,
	isValidatorCapturing,
	type ValidatorSlot
} from '../compile/aot'

import {
	Decode,
	Compile,
	applyCoercions,
	TypeBoxValidator,
	TypeBoxValidatorCache,
	Intersect,
	HasCodec
} from '../type/bridge'

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

	From?(value: unknown, type?: string): MaybePromise<unknown>

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
			if (!options?.schemas?.length) return undefined
			name = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		let schema = Validator.reference(name, options?.models)

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
			const skipCache = options?.normalize === false || !!options?.sanitize
			const aot = options?.aot
			const slot = options?.slot

			const bypassCache =
				!!aot &&
				!!slot &&
				(isValidatorCapturing() ||
					(options?.normalize !== 'typebox' &&
						// lazy-aware: checks existence without materializing the group
						Compiled.hasValidator(aot.method, aot.path, slot)))

			if (!isIntersectable && !skipCache && !bypassCache && tbCache) {
				const cached = tbCache.get(schema, options?.coerces)
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
				tbCache!.set(schema, options?.coerces, validator)
			return validator
		}

		if ('~standard' in schema) return new StandardValidator(schema) as any

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
			if (!options?.schemas?.length) return undefined
			schema = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		schema = Validator.reference(schema, options?.models)

		const responseSlot = (status: number | string) =>
			options?.aot ? (`response:${status}` as ValidatorSlot) : undefined

		if ('~kind' in schema || '~elyAcl' in schema || '~standard' in schema)
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
	}
}

const toStatusBased = (
	schema:
		| TSchema
		| StandardSchemaV1Like
		| Record<number, TSchema | StandardSchemaV1Like>
): Record<number, AnySchema> =>
	'~kind' in schema || '~elyAcl' in schema || '~standard' in schema
		? { 200: schema as unknown as AnySchema }
		: (schema as Record<number, AnySchema>)

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

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	From(value: unknown, type?: string): unknown {
		const q = this.validate(value)

		if (q instanceof Promise)
			return q.then((resolved) => {
				if (resolved.issues)
					throw new ValidationError(type, value, resolved.issues)

				return resolved.value
			})

		// @ts-expect-error
		if (q.issues) throw new ValidationError(type, value, q.issues)

		// @ts-expect-error
		return q.value
	}
}

export class MultiValidator extends Validator {
	override isAsync = false

	private schemas: (TSchema | StandardSchemaV1Like)[]
	private codecs: boolean[]

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options: ValidatorOptions
	) {
		super()

		let typeboxObjects
		const schemas = [schema].concat(options.schemas!)

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
				} else
					schemas[i] = Compile(
						applyCoercions(schema, options?.coerces)
					)
			}
		}

		if (typeboxObjects)
			schemas.push(
				Compile(
					applyCoercions(Intersect(typeboxObjects), options?.coerces)
				)
			)

		this.schemas = schemas

		const codecs: boolean[] = []
		for (let i = 0; i < schemas.length; i++)
			codecs.push(
				'~standard' in schemas[i]
					? false
					: HasCodec(
							(
								schemas[i] as unknown as CompiledTypeBoxValidator
							).Type()
						)
			)

		this.codecs = codecs
	}

	Check(value: unknown): boolean {
		for (let i = 0; i < this.schemas.length; i++) {
			const validator = this.schemas[i]

			if ('~standard' in validator) {
				// @ts-expect-error
				if (validator['~standard'].validate(value).issues) return false
				continue
			}

			if (!this.codecs[i]) {
				if (!(validator as TypeBoxValidator).Check(value)) return false
				continue
			}

			try {
				;(validator as TypeBoxValidator).Decode(value)
			} catch {
				return false
			}
		}

		return true
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const errors: TLocalizedValidationError[] = []

		for (const schema of this.schemas)
			if ('~standard' in schema) {
				// @ts-expect-error
				const issues = schema['~standard'].validate(value).issues
				if (issues) errors.push(...issues)
			} else errors.push(...(schema as TypeBoxValidator).Errors(value))

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
					: Decode(validator as TypeBoxValidator, value)

			if (snapshot! === undefined) snapshot = result
			else if (typeof snapshot === 'object' && typeof result === 'object')
				snapshot = Object.assign(snapshot, result)
			else if (Array.isArray(snapshot) && Array.isArray(result))
				snapshot.push(...result)
			else throw new Error('Unable to merged value with different type')
		}

		return snapshot!
	}

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	From(value: unknown, type?: string): unknown {
		let snapshot: Record<string, unknown> | unknown[]

		for (let i = 0; i < this.schemas.length; i++) {
			const validator = this.schemas[i]

			let result
			if ('~standard' in validator) {
				// @ts-expect-error
				const q = validator['~standard'].validate(value)

				if (!(q instanceof Promise) && q.issues)
					throw new ValidationError(type, value, q.issues)

				result = q.value
			} else {
				if (this.codecs[i]) {
					// decode-as-gate, see Check
					try {
						;(validator as TypeBoxValidator).Decode(value)
					} catch {
						throw new ValidationError(
							type,
							value,
							(validator as TypeBoxValidator).Errors(value)
						)
					}
				} else if (!(validator as TypeBoxValidator).Check(value))
					throw new ValidationError(
						type,
						value,
						(validator as TypeBoxValidator).Errors(value)
					)

				result = Decode(validator as TypeBoxValidator, value)
			}

			if (snapshot! === undefined) snapshot = result
			else if (typeof snapshot === 'object' && typeof result === 'object')
				snapshot = Object.assign(snapshot, result)
			else if (Array.isArray(snapshot) && Array.isArray(result))
				snapshot.push(...result)
			else throw new Error('Unable to merged value with different type')
		}

		return snapshot!
	}
}

let tbCache: typeof TypeBoxValidatorCache | undefined
