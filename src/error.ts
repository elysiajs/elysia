import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type {
	TypeCheck,
	ValueError,
	ValueErrorIterator
} from '@sinclair/typebox/compiler'

import { StatusMap, InvertedStatusMap } from './utils'
import type { ElysiaTypeCheck } from './schema'

// ? Cloudflare worker support
const env =
	typeof Bun !== 'undefined'
		? Bun.env
		: typeof process !== 'undefined'
			? process?.env
			: undefined

export const ERROR_CODE = Symbol('ElysiaErrorCode')
export type ERROR_CODE = typeof ERROR_CODE

export const isProduction = (env?.NODE_ENV ?? env?.ENV) === 'production'

export type ElysiaErrors =
	| InternalServerError
	| NotFoundError
	| ParseError
	| ValidationError
	| InvalidCookieSignature

const emptyHttpStatus = {
	101: undefined,
	204: undefined,
	205: undefined,
	304: undefined,
	307: undefined,
	308: undefined
} as const

export class ElysiaCustomStatusResponse<
	const in out Code extends number | keyof StatusMap,
	in out T = Code extends keyof InvertedStatusMap
		? InvertedStatusMap[Code]
		: Code,
	const in out Status extends Code extends keyof StatusMap
		? StatusMap[Code]
		: Code = Code extends keyof StatusMap ? StatusMap[Code] : Code
> {
	code: Status
	response: T

	constructor(code: Code, response: T) {
		const res =
			response ??
			(code in InvertedStatusMap
				? // @ts-expect-error Always correct
					InvertedStatusMap[code]
				: code)

		// @ts-ignore Trust me bro
		this.code = StatusMap[code] ?? code

		if (code in emptyHttpStatus) this.response = undefined as any
		else
			// @ts-ignore Trust me bro
			this.response = res
	}
}

export const status = <
	const Code extends number | keyof StatusMap,
	const T = Code extends keyof InvertedStatusMap
		? InvertedStatusMap[Code]
		: Code
>(
	code: Code,
	response?: T
) => new ElysiaCustomStatusResponse<Code, T>(code, response as any)

/**
 * @deprecated use `Elysia.status` instead
 */
export const error = status

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

	constructor(cause?: Error) {
		super('Bad Request', {
			cause
		})
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

export const mapValueError = (error: ValueError | undefined) => {
	if (!error)
		return {
			summary: undefined
		}

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
				summary: `${message
					.slice(0, 9)
					.trim()} property '${property}' to be ${message
					.slice(8)
					.trim()} but found: ${value}`
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

export class InvalidFileType extends Error {
	code = 'INVALID_FILE_TYPE'
	status = 422

	constructor(
		public property: string,
		public expected: string | string[],
		public message = `"${property}" has invalid file type`
	) {
		super(message)

		Object.setPrototypeOf(this, InvalidFileType.prototype)
	}

	toResponse(headers?: Record<string, any>) {
		if (isProduction)
			return new Response(
				JSON.stringify({
					type: 'validation',
					on: 'body'
				}),
				{
					status: 422,
					headers: {
						...headers,
						'content-type': 'application/json'
					}
				}
			)

		return new Response(
			JSON.stringify({
				type: 'validation',
				on: 'body',
				summary: 'Invalid file type',
				message: this.message,
				property: this.property,
				expected: this.expected
			}),
			{
				status: 422,
				headers: {
					...headers,
					'content-type': 'application/json'
				}
			}
		)
	}
}

export class ValidationError extends Error {
	code = 'VALIDATION'
	status = 422

	valueError?: ValueError
	expected?: unknown
	customError?: string

	constructor(
		public type: string,
		public validator: TSchema | TypeCheck<any> | ElysiaTypeCheck<any>,
		public value: unknown,
		errors?: ValueErrorIterator
	) {
		if (
			value &&
			typeof value === 'object' &&
			value instanceof ElysiaCustomStatusResponse
		)
			value = value.response

		const error =
			errors?.First() ??
			('Errors' in validator
				? validator.Errors(value).First()
				: Value.Errors(validator, value).First())

		const accessor = error?.path || 'root'

		// @ts-ignore private field
		const schema = validator?.schema ?? validator

		let expected

		if (!isProduction) {
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
		}

		const customError =
			error?.schema?.message || error?.schema?.error !== undefined
				? typeof error.schema.error === 'function'
					? error.schema.error(
							isProduction
								? {
										type: 'validation',
										on: type,
										found: value
									}
								: {
										type: 'validation',
										on: type,
										value,
										property: accessor,
										message: error?.message,
										summary: mapValueError(error).summary,
										found: value,
										expected,
										errors:
											'Errors' in validator
												? [
														...validator.Errors(
															value
														)
													].map(mapValueError)
												: [
														...Value.Errors(
															validator,
															value
														)
													].map(mapValueError)
									},
							validator
						)
					: error.schema.error
				: undefined

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
				found: value
			})
		} else {
			message = JSON.stringify(
				{
					type: 'validation',
					on: type,
					property: accessor,
					message: error?.message,
					summary: mapValueError(error).summary,
					expected,
					found: value,
					errors:
						'Errors' in validator
							? [...validator.Errors(value)].map(mapValueError)
							: [...Value.Errors(validator, value)].map(
									mapValueError
								)
				},
				null,
				2
			)
		}

		super(message)

		this.valueError = error
		this.expected = expected
		this.customError = customError

		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	get all() {
		return 'Errors' in this.validator
			? [...this.validator.Errors(this.value)].map(mapValueError)
			: // @ts-ignore
				[...Value.Errors(this.validator, this.value)].map(mapValueError)
	}

	static simplifyModel(
		validator: TSchema | TypeCheck<any> | ElysiaTypeCheck<any>
	) {
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

	/**
	 * Utility function to inherit add custom error and keep the original Validation error
	 *
	 * @since 1.3.14
	 *
	 * @example
	 * ```ts
	 * new Elysia()
	 *		.onError(({ error, code }) => {
	 *			if (code === 'VALIDATION') return error.detail(error.message)
	 *		})
	 *		.post('/', () => 'Hello World!', {
	 *			body: t.Object({
	 *				x: t.Number({
	 *					error: 'x must be a number'
	 *				})
	 *			})
	 *		})
	 * ```
	 */
	detail(message: unknown) {
		if (!this.customError) return this.message

		const validator = this.validator
		const value = this.value
		const expected = this.expected
		const errors = this.all

		return isProduction
			? {
					type: 'validation',
					on: this.type,
					found: value,
					message
				}
			: {
					type: 'validation',
					on: this.type,
					property: this.valueError?.path || 'root',
					message,
					summary: mapValueError(this.valueError).summary,
					found: value,
					expected,
					errors
				}
	}
}
