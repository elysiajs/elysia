import { TypeCheck } from '@sinclair/typebox/compiler'
import type { ErrorCode } from './types'

interface ValidationErrorOptions<T = unknown> extends ErrorOptions {
	validator: TypeCheck<any>
	value: T
	type: string
}


export class ElysiaError extends Error {
	constructor(message: ErrorCode, opts?: ErrorOptions) {
		super(message, opts)
	}
}

export class ValidationError extends ElysiaError {
	constructor(public readonly opts: ValidationErrorOptions) {
		super('VALIDATION', { cause: opts.cause })
		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	all() {
		return [...this.opts.validator.Errors(this.opts.value)]
	}
}
