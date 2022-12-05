import type { ErrorCode } from './types'

const knownErrors = new Set<string>([
	'BODY_LIMIT',
	'BODY_LIMIT',
	'INTERNAL_SERVER_ERROR',
	'NOT_FOUND',
	'VALIDATION'
])

export const mapErrorCode = (error: string): ErrorCode =>
	knownErrors.has(error) ? (error as ErrorCode) : 'UNKNOWN'
