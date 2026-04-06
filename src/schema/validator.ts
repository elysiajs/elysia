import type { TSchema } from 'typebox'
import { Compile } from 'typebox/schema'
import type { Validator as TypeBoxValidator } from 'typebox/schema'
import type { TLocalizedValidationError } from 'typebox/error'
import { createMirror } from 'exact-mirror'

import { t } from '../type'
import { applyCoercions, type CoerceOption } from './coerce'
import type { ElysiaConfig, StandardSchemaV1Like } from '../types'
import { Clean, Decode, Encode, Errors, HasCodec } from 'typebox/value'

interface ValidatorOptions {
	schemas?: (TSchema | StandardSchemaV1Like)[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any>['sanitize']
}

const returnAsIs = (v: unknown) => v

export class Validator {
	tb?: TypeBoxValidator

	Check: (data: unknown) => boolean
	Errors: (value: unknown) => TLocalizedValidationError[]
	Decode?: (data: unknown) => unknown
	Encode?: (data: unknown) => unknown
	Clean?: (data: unknown) => unknown

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options?: ValidatorOptions
	) {
		if (options?.schemas?.length) {
			if (
				'~kind' in schema &&
				options.schemas.every((v) => '~kind' in v || '~elyAcl' in v)
			)
				schema = t.Evaluate(
					t.Intersect([schema as TSchema].concat(options.schemas))
				)
			else {
				let typeboxObjects
				const schemas = [schema].concat(options.schemas)
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

				if (typeboxObjects) {
					schemas.push(
						Compile(
							applyCoercions(
								t.Evaluate(t.Intersect(typeboxObjects)),
								options?.coerces
							)
						)
					)
					typeboxObjects = undefined
				}

				this.Check = (value) =>
					schemas.every((validator) =>
						'~standard' in validator
							? // @ts-expect-error
								validator['~standard'].validate(value).value
							: (validator as TypeBoxValidator).Check(value)
					)

				this.Errors = (value) => {
					const errors: TLocalizedValidationError[] = []

					for (const schema of schemas)
						if ('~standard' in schema) {
							const issues =
								// @ts-expect-error
								schema['~standard'].validate(value).issues

							if (issues) errors.push(...issues)
						} else {
							errors.push(
								...Errors(
									(schema as TypeBoxValidator).Schema(),
									value
								)
							)
						}

					return errors
				}

				this.Decode = (input) => {
					let snapshot: Record<string, unknown> | unknown[]

					for (let i = 0; i < schemas.length; i++) {
						const validator = schemas[i]

						const value =
							'~standard' in validator
								? // @ts-expect-error
									validator['~standard'].validate(input).value
								: codexIndexes.has(i)
									? Decode(
											validator as TypeBoxValidator,
											input
										)
									: input

						if (snapshot! === undefined) snapshot = value
						else if (
							typeof snapshot === 'object' &&
							typeof value === 'object'
						)
							snapshot = Object.assign(snapshot, value)
						else if (
							Array.isArray(snapshot) &&
							Array.isArray(value)
						)
							snapshot.push(...value)
						else
							throw new Error(
								'Unable to merged value with different type'
							)
					}

					return snapshot!
				}

				this.Encode = returnAsIs
				this.Clean = returnAsIs

				return
			}
		}

		if ('~kind' in schema || '~elyAcl' in schema) {
			this.tb = Compile(applyCoercions(schema, options?.coerces))

			this.Check = this.tb.Check.bind(this.tb)
			this.Errors = (value: unknown) => Errors(this.tb!, value)
			if (HasCodec(schema)) {
				this.Decode = (value: unknown) => Decode(this.tb!, value)
				this.Encode = (value: unknown) => Encode(this.tb!, value)
			}

			try {
				this.Clean =
					!options?.normalize || options.normalize === 'exactMirror'
						? createMirror(schema, {
								Compile,
								sanitize: options?.sanitize
							})
						: options.normalize === 'typebox'
							? (value) => Clean(this.tb!, value)
							: returnAsIs
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)

				this.Clean = (value) => Clean(this.tb!, value)
			}
		} else if ('~standard' in schema) {
			const standard = schema['~standard']

			// @ts-expect-error
			this.Check = (value) => 'value' in standard.validate(value)
			this.Errors = (value) =>
				// @ts-expect-error
				standard.validate(value).issues ?? []
			// @ts-expect-error
			this.Decode = (value) => standard.validate(value).value
		} else
			throw new Error(
				'Elysia Validator support only TypeBox and Standard Schema'
			)
	}

	static response = (
		schema: Record<number, TSchema | StandardSchemaV1Like>,
		options?: ValidatorOptions
	): Record<number, Validator> =>
		Object.fromEntries(
			Object.entries(schema).map(([k, v]) => [
				k,
				v instanceof Validator ? v : new Validator(v, options)
			])
		)
}
