import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { TypeCheck, ValueError } from '@sinclair/typebox/compiler'

import { StatusMap, InvertedStatusMap } from './utils'

// ? Cloudflare worker support
const env =
	typeof Bun !== 'undefined'
		? Bun.env
		: typeof process !== 'undefined'
			? process?.env
			: undefined

export const ERROR_CODE = Symbol('ElysiaErrorCode')
export type ERROR_CODE = typeof ERROR_CODE

export const ELYSIA_RESPONSE = Symbol('ElysiaResponse')
export type ELYSIA_RESPONSE = typeof ELYSIA_RESPONSE

export const isProduction = (env?.NODE_ENV ?? env?.ENV) === 'production'

export type ElysiaErrors =
	| InternalServerError
	| NotFoundError
	| ParseError
	| ValidationError
	| InvalidCookieSignature

export const error = <
	const Code extends number | keyof StatusMap,
	const T = Code extends keyof InvertedStatusMap
		? InvertedStatusMap[Code]
		: Code,
	const Status extends Code extends keyof StatusMap
		? StatusMap[Code]
		: Code = Code extends keyof StatusMap ? StatusMap[Code] : Code
>(
	code: Code,
	response?: T
): {
	[ELYSIA_RESPONSE]: Status
	response: T
	_type: {
		[ERROR_CODE in Status]: T
	}
	error: Error
} => {
	const res = response ??
		(code in InvertedStatusMap
			? // @ts-expect-error Always correct
				InvertedStatusMap[code]
			: code)

	return {
		// @ts-expect-error trust me bro
		[ELYSIA_RESPONSE]: StatusMap[code] ?? code,
		response: res,
		_type: undefined as any,
		error: new Error(res)
	} as const
}

export class InternalServerError extends Error {
	code = 'INTERNAL_SERVER_ERROR'
	status = 500

	constructor(message?: string) {
		super(message ?? 'INTERNAL_SERVER_ERROR')
	}
}

export class NotFoundError extends Error {
	code = 'NOT_FOUND'
	status = 404

	constructor(message?: string) {
		super(message ?? 'NOT_FOUND')
	}
}

export class ParseError extends Error {
	code = 'PARSE'
	status = 400

	constructor() {
		super('Failed to parse body')
	}
}

export class InvalidCookieSignature extends Error {
	code = 'INVALID_COOKIE_SIGNATURE'
	status = 400

	constructor(
		public key: string,
		message?: string
	) {
		super(message ?? `"${key}" has invalid cookie signature`)
	}
}

export const mapValueError = (error: ValueError) => {
	const { message, path, value, type } = error

	const property = path.slice(1).replaceAll('/', '.')
	const isRoot = path === ''

	switch (type) {
		case 42:
			return {
				...error,
				summary: isRoot
					? `Value should not be provided`
					: `Property '${property}' should not be provided`
			}

		case 45:
			return {
				...error,
				summary: isRoot
					? `Value is missing`
					: `Property '${property}' is missing`
			}

		case 50:
			// Expected string to match 'email' format
			const quoteIndex = message.indexOf("'")!
			const format = message.slice(
				quoteIndex + 1,
				message.indexOf("'", quoteIndex + 1)
			)

			return {
				...error,
				summary: isRoot
					? `Value should be an email`
					: `Property '${property}' should be ${format}`
			}

		case 54:
			return {
				...error,
				summary: `${message.slice(
					0,
					9
				)} property '${property}' to be ${message.slice(
					8
				)} but found: ${value}`
			}

		case 62:
			const union = error.schema.anyOf
				.map((x: Record<string, unknown>) => `'${x?.format ?? x.type}'`)
				.join(', ')

			return {
				...error,
				summary: isRoot
					? `Value should be one of ${union}`
					: `Property '${property}' should be one of: ${union}`
			}

		default:
			return { summary: message, ...error }
	}
}

export class ValidationError extends Error {
	code = 'VALIDATION'
	status = 422

	constructor(
		public type: string,
		public validator: TSchema | TypeCheck<any>,
		public value: unknown
	) {
		if (value && typeof value === 'object' && ELYSIA_RESPONSE in value)
			// @ts-expect-error
			value = value.response

		const error = isProduction
			? undefined
			: 'Errors' in validator
				? validator.Errors(value).First()
				: Value.Errors(validator, value).First()

		const customError =
			error?.schema.error !== undefined
				? typeof error.schema.error === 'function'
					? error.schema.error({
							type,
							validator,
							value,
							get errors() {
								return [...validator.Errors(value)].map(
									mapValueError
								)
							}
						})
					: error.schema.error
				: undefined

		const accessor = error?.path || 'root'
		let message = ''

		if (customError !== undefined) {
			message =
				typeof customError === 'object'
					? JSON.stringify(customError)
					: customError + ''
		} else if (isProduction) {
			message = JSON.stringify({
				type: 'validation',
				on: type,
				summary: mapValueError(error).summary,
				message: error?.message,
				found: value
			})
		} else {
			// @ts-ignore private field
			const schema = validator?.schema ?? validator
			const errors =
				'Errors' in validator
					? [...validator.Errors(value)].map(mapValueError)
					: [...Value.Errors(validator, value)].map(mapValueError)

			let expected

			try {
				expected = Value.Create(schema)
			} catch (error) {
				expected = {
					type: 'Could not create expected value',
					// @ts-expect-error
					message: error?.message,
					error
				}
			}

			message = JSON.stringify(
				{
					type: 'validation',
					on: type,
					summary: errors[0]?.summary,
					property: accessor,
					message: error?.message,
					expected,
					found: value,
					errors
				},
				null,
				2
			)
		}

		super(message)

		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	get all() {
		return 'Errors' in this.validator
			? [...this.validator.Errors(this.value)].map(mapValueError)
			: // @ts-ignore
				[...Value.Errors(this.validator, this.value)].map(mapValueError)
	}

	static simplifyModel(validator: TSchema | TypeCheck<any>) {
		// @ts-ignore
		const model = 'schema' in validator ? validator.schema : validator

		try {
			return Value.Create(model)
		} catch {
			return model
		}
	}

	get model() {
		return ValidationError.simplifyModel(this.validator)
	}

	toResponse(headers?: Record<string, any>) {
		return new Response(this.message, {
			status: 400,
			headers: {
				...headers,
				'content-type': 'application/json'
			}
		})
	}
}
