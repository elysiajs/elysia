import type { TypeCheck } from '@sinclair/typebox/compiler'

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
		type: string,
		public validator: TypeCheck<any>,
		public value: unknown
	) {
		const error = validator.Errors(value).First()

		super(
			`Invalid ${type}: '${error?.path?.slice(1) || 'root'}'. ${
				error?.message
			}`
		)
	}

	get all() {
		return [...this.validator.Errors(this.value)]
	}
}
