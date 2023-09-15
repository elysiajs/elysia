import { Value } from '@sinclair/typebox/value'
import type { TypeCheck } from '@sinclair/typebox/compiler'

// ? Cloudflare worker support
const env =
	typeof Bun !== 'undefined'
		? Bun.env
		: typeof process !== 'undefined'
		? process?.env
		: undefined

export const ERROR_CODE = Symbol('ErrorCode')

export const isProduction = (env?.NODE_ENV ?? env?.ENV) === 'production'

export type ElysiaErrors =
	| InternalServerError
	| NotFoundError
	| ParseError
	| ValidationError

export class InternalServerError extends Error {
	code = 'INTERNAL_SERVER_ERROR'
	status = 500

	constructor() {
		super('INTERNAL_SERVER_ERROR')
	}
}

export class NotFoundError extends Error {
	code = 'NOT_FOUND'
	status = 404

	constructor() {
		super('NOT_FOUND')
	}
}

export class ParseError extends Error {
	code = 'PARSE'
	status = 400

	constructor() {
		super('PARSE')
	}
}

export class ValidationError extends Error {
	code = 'VALIDATION'
	status = 400

	constructor(
		public type: string,
		public validator: TypeCheck<any>,
		public value: unknown
	) {
		const error = isProduction ? undefined : validator.Errors(value).First()
		const customError = error?.schema.error
			? typeof error.schema.error === 'function'
				? error.schema.error(type, validator, value)
				: error.schema.error
			: undefined

		const message = isProduction
			? customError ??
			  `Invalid ${type ?? error?.schema.error ?? error?.message}`
			: customError ??
			  `Invalid ${type}, '${error?.path?.slice(1) || 'type'}': ${
					error?.message
			  }` +
					'\n\n' +
					'Expected: ' +
					// @ts-ignore
					JSON.stringify(Value.Create(validator.schema), null, 2) +
					'\n\n' +
					'Found: ' +
					JSON.stringify(value, null, 2)
		// +
		// '\n\n' +
		// 'Schema: ' +
		// // @ts-ignore
		// JSON.stringify(validator.schema, null, 2) +
		// '\n'

		super(message)

		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	get all() {
		return [...this.validator.Errors(this.value)]
	}

	get model() {
		// @ts-ignore
		return Value.Create(this.validator.schema)
	}

	toResponse(headers?: Record<string, any>) {
		return new Response(this.message, {
			status: 400,
			headers
		})
	}
}
