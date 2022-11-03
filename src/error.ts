import type { ErrorCode } from './types'

export default class KingWorldError extends Error {
	code: ErrorCode = 'UNKNOWN'

	constructor(
		code: ErrorCode & string,
		message: string = code,
		options?: ErrorOptions
	) {
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

			case 'VALIDATION':
				this.code = 'VALIDATION'
				break

			default:
				break
		}

		if (
			message.startsWith('Invalid query') ||
			message.startsWith('Invalid body') ||
			message.startsWith('Invalid params') ||
			message.startsWith('Invalid headers') ||
			message.startsWith('Invalid body')
		)
			this.code = 'VALIDATION'
	}
}
