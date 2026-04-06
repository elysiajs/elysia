import type { Static, StaticDecode, StaticEncode, TSchema } from 'typebox'
import { Compile } from 'typebox/schema'
import type { Validator as BaseTypeBoxValidator } from 'typebox/schema'
import type { TLocalizedValidationError } from 'typebox/error'
import { createMirror } from 'exact-mirror'

import { t } from '../type'
import { applyCoercions, type CoerceOption } from './coerce'
import type { AnySchema, ElysiaConfig, StandardSchemaV1Like } from '../types'
import { Clean, Decode, Encode, Errors, HasCodec } from 'typebox/value'

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

	Clean(value: unknown): unknown {
		return value
	}

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
					t.Intersect([schema as TSchema].concat(options.schemas))
				) as AnySchema
			else return new MultiValidator(schema, options) as any
		}

		if ('~kind' in schema || '~elyAcl' in schema)
			return new TypeBoxValidator(schema, options) as any

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

export class TypeBoxValidator<
	const in out T extends TSchema
> extends Validator {
	tb: BaseTypeBoxValidator
	hasCodec: boolean
	schema: T

	constructor(schema: T, options?: ValidatorOptions) {
		super()

		this.schema = applyCoercions(schema, options?.coerces) as T
		this.tb = Compile(this.schema)
		this.hasCodec = HasCodec(this.schema)

		try {
			this.Clean =
				!options?.normalize || options.normalize === 'exactMirror'
					? createMirror(schema, {
							Compile,
							sanitize: options?.sanitize
						})
					: options.normalize === 'typebox'
						? (value) => Clean(this.tb!, value)
						: (value) => value
		} catch (error) {
			console.warn(
				'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
			)
			console.warn(schema)
			console.warn(error)

			this.Clean = (value) => Clean(this.tb!, value)
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
		return this.hasCodec ? Decode(this.schema, value) : (value as any)
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return this.hasCodec ? Encode(this.schema, value) : (value as any)
	}
}

class StandardValidator extends Validator {
	private validate: (value: unknown) => any

	constructor(schema: StandardSchemaV1Like) {
		super()
		// @ts-expect-error
		this.validate = schema['~standard'].validate
	}

	Check(value: unknown): boolean {
		return 'value' in this.validate(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return this.validate(value).issues ?? []
	}

	Decode(value: unknown): unknown {
		return this.validate(value).value
	}
}

class MultiValidator extends Validator {
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
				: (validator as TypeBoxValidator).Check(value)
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
}
