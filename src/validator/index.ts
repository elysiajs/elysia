import type { TSchema } from 'typebox/type'
import type { Validator as BaseTypeBoxValidator } from 'typebox/schema'
import type { TLocalizedValidationError } from 'typebox/error'

import { type AnySchema, type StandardSchemaV1Like } from '../type'

import type { ElysiaConfig, MaybePromise } from '../types'
import type { CoerceOption } from '../type/coerce'

import { Intersect } from '../type/elysia/intersect'
import {
	Decode,
	Compile,
	Errors,
	applyCoercions,
	TypeBoxValidator,
	TypeBoxValidatorCache
} from '../type/bridge'

export interface ValidatorOptions {
	schemas?: AnySchema[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any, any>['sanitize']
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
				schema = Intersect([
					schema as TSchema,
					...options.schemas
				]) as AnySchema
			else return new MultiValidator(schema, options) as any
		}

		if ('~kind' in schema || '~elyAcl' in schema) {
			if (tbCache) {
				const cached = tbCache.get(schema, options?.coerces)
				if (cached) return cached
			}
			// @ts-expect-error
			else tbCache = new TypeBoxValidatorCache()

			// @ts-expect-error
			const validator = new TypeBoxValidator(schema, options) as any
			tbCache!.set(schema, options?.coerces, validator)
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

	static clear() {
		tbCache?.clear()
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
				// if (HasCodec(schema)) codexIndexes.add(i)

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

let tbCache: typeof TypeBoxValidatorCache | undefined
