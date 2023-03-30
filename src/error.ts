import type { TypeCheck } from '@sinclair/typebox/compiler'
import type { ErrorCode } from './types'

const errorCodeToStatus = new Map<ErrorCode, number>()
errorCodeToStatus.set('INTERNAL_SERVER_ERROR', 500)
errorCodeToStatus.set('NOT_FOUND', 404)
errorCodeToStatus.set('VALIDATION', 400)

const knownErrors = new Set<ErrorCode>(errorCodeToStatus.keys())

export const mapErrorCode = (error: string): ErrorCode =>
	knownErrors.has(error as ErrorCode) ? (error as ErrorCode) : 'UNKNOWN'

export const mapErrorStatus = (error: string): number =>
	errorCodeToStatus.get(error as ErrorCode) ?? 500

interface ValidationErrorOptions<T = unknown> extends ErrorOptions {
	validator: TypeCheck<any>
	value: T
	type: string
}

export class ValidationError extends Error {
	constructor(public readonly opts: ValidationErrorOptions) {
		super('VALIDATION', { cause: opts.cause })
		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	all() {
		return [...this.opts.validator.Errors(this.opts.value)]
	}
}
