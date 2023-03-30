import { ErrorCode } from '../types'

export class ElysiaError extends Error {
	constructor(message: ErrorCode, opts?: ErrorOptions) {
		super(message, opts)
	}
}
