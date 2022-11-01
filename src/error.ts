import type { ErrorCode } from './types'

export default class KingWorldError extends Error {
	code: ErrorCode = 'UNKNOWN'

	constructor(message: ErrorCode & string, options?: ErrorOptions) {
		super(message, options)

		switch (message as ErrorCode) {
			case 'BODY_LIMIT':
				this.code = 'BODY_LIMIT'
				break

			case 'INTERNAL_SERVER_ERROR':
				this.code = 'INTERNAL_SERVER_ERROR'
				break

			case 'NOT_FOUND':
				this.code = 'NOT_FOUND'
				break

			default:
				break
		}
	}
}
