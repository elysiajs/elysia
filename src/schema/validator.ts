import type { TSchema } from 'typebox'
import { Compile } from 'typebox/compile'
import type { Validator } from 'typebox/compile'
import type { TLocalizedValidationError } from 'typebox/error'
import { createMirror } from 'exact-mirror'

import { t } from '../type-system'
import { applyCoercions, type CoerceOption } from './coerce'
import type { ElysiaConfig, MaybeArray, StandardSchemaV1Like } from '../types'

interface ElysiaValidatorParams {
	schemas?: (TSchema | StandardSchemaV1Like)[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any>['sanitize']
}

const returnAsIs = (v: unknown) => v

export class ElysiaValidator {
	tb?: Validator

	Check: (data: unknown) => boolean
	Errors: (value: unknown) => TLocalizedValidationError[]
	Decode: (data: unknown) => unknown
	Encode: (data: unknown) => unknown
	Clean: (data: unknown) => unknown

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		params?: ElysiaValidatorParams
	) {
		if (params?.schemas?.length) {
			if (
				'~kind' in schema &&
				params.schemas.every((v) => '~kind' in v || '~elyAcl' in v)
			)
				schema = t.Evaluate(
					t.Intersect([schema as TSchema].concat(params.schemas))
				)
			else {
				let typeboxObjects
				const schemas = [schema].concat(params.schemas)
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
								applyCoercions(schema, params?.coerces)
							)
					}
				}

				if (typeboxObjects) {
					schemas.push(
						Compile(
							applyCoercions(
								t.Evaluate(t.Intersect(typeboxObjects)),
								params?.coerces
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
							: (validator as Validator).Check(value)
					)

				this.Errors = (value) => {
					const errors: TLocalizedValidationError[] = []

					for (const schema of schemas)
						if ('~standard' in schema) {
							const issues =
								// @ts-expect-error
								schema['~standard'].validate(value).issues

							if (issues) errors.push(...issues)
						} else
							errors.push(...(schema as Validator).Errors(value))

					return errors
				}

				this.Decode = (input) => {
					let snapshot: Record<string, unknown> | unknown[]

					for (const validator of schemas) {
						const value =
							'~standard' in validator
								? // @ts-expect-error
									validator['~standard'].validate(input).value
								: (validator as Validator).Decode(input)

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
			this.tb = Compile(applyCoercions(schema, params?.coerces))

			this.Check = this.tb.Check.bind(this.tb)
			this.Errors = this.tb.Errors.bind(this.tb)
			this.Decode = this.tb.Decode.bind(this.tb)
			this.Encode = this.tb.Encode.bind(this.tb)

			this.Clean =
				!params?.normalize || params.normalize === 'exactMirror'
					? createMirror(schema, {
							Compile,
							sanitize: params?.sanitize
						})
					: params.normalize === 'typebox'
						? this.tb.Clean.bind(this.tb)
						: returnAsIs
		} else if ('~standard' in schema) {
			const standard = schema['~standard']

			// @ts-expect-error
			this.Check = (value) => 'value' in standard.validate(value)
			this.Errors = (value) =>
				// @ts-expect-error
				standard.validate(value).issues ?? []
			// @ts-expect-error
			this.Decode = (value) => standard.validate(value).value
			this.Encode = returnAsIs
			this.Clean = returnAsIs
		} else
			throw new Error(
				'Elysia Validator support only TypeBox and Standard Schema'
			)
	}
}
