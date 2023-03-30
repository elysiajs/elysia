import { TypeCheck } from '@sinclair/typebox/compiler'
import { ElysiaError } from './base-elysia-error'

interface ValidationErrorOptions extends ErrorOptions {
	validator: TypeCheck<any>
	value: any
	type: string
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
