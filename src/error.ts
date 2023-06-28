import { Value } from '@sinclair/typebox/value'
import type { TypeCheck } from '@sinclair/typebox/compiler'

const isProduction =
	process.env.NODE_ENV === 'production' || process.env.ENV === 'production'

export class InternalServerError extends Error {
	code = 'NOT_FOUND'
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

		const message = isProduction
			? `Invalid ${type}`
			: `Invalid ${type}, '${error?.path?.slice(1) || 'type'}': ${
					error?.message
			  }` +
			  '\n\n' +
			  'Expected: ' +
			  // @ts-ignore
			  JSON.stringify(Value.Create(validator.schema), null, 2) +
			  '\n\n' +
			  'Found: ' +
			  JSON.stringify(value, null, 2) +
			  '\n\n' +
			  'Schema: ' +
			  // @ts-ignore
			  JSON.stringify(validator.schema, null, 2) +
			  '\n'

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
