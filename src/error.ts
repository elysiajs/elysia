import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import { StatusMap, InvertedStatusMap } from './utils'

// ? Cloudflare worker support
const env =
	typeof Bun !== 'undefined'
		? Bun.env
		: typeof process !== 'undefined'
		? process?.env
		: undefined

export const ERROR_CODE = Symbol('ElysiaErrorCode')
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
	const Status extends number = Code extends keyof StatusMap
		? StatusMap[Code]
		: Code
>(
	code: Code,
	response?: T
): {
	[ELYSIA_RESPONSE]: Status
	response: T
	_type: {
		[ERROR_CODE in Status]: T
	}
} =>
	({
		// @ts-expect-error
		[ELYSIA_RESPONSE]: StatusMap[code] ?? code,
		response:
			response ??
			(code in InvertedStatusMap
				? // @ts-expect-error Always correct
				  InvertedStatusMap[code]
				: code),
		_type: undefined as any
	} as const)

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

	constructor(message?: string, public body?: unknown) {
		super(message ?? 'PARSE')
	}
}

export class InvalidCookieSignature extends Error {
	code = 'INVALID_COOKIE_SIGNATURE'
	status = 400

	constructor(public key: string, message?: string) {
		super(message ?? `"${key}" has invalid cookie signature`)
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
		// @ts-expect-error
		if (typeof value === 'object' && ELYSIA_RESPONSE in value)
			// @ts-expect-error
			value = value.response

		const error = isProduction
			? undefined
			: 'Errors' in validator
			? validator.Errors(value).First()
			: Value.Errors(validator, value).First()

		const customError = error?.schema.error
			? typeof error.schema.error === 'function'
				? error.schema.error(type, validator, value)
				: error.schema.error
			: undefined

		const accessor = error?.path || 'root'
		let message = ''

		if (customError) {
			message =
				typeof customError === 'object'
					? JSON.stringify(customError)
					: customError + ''
		} else if (isProduction) {
			message = JSON.stringify({
				type: "validation",
				on: type,
				message: error?.message,
				found: value
			})
		} else {
			// @ts-ignore private field
			const schema = validator?.schema ?? validator
			const errors =
				'Errors' in validator
					? [...validator.Errors(value)]
					: [...Value.Errors(validator, value)]

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
					type: "validation",
					on: type,
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
		return [...this.validator.Errors(this.value)]
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
