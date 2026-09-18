import { ElysiaError } from '../error'
import { isProduction } from '../universal/is-production'

export class InvalidCookie extends ElysiaError {
	status = 400 as const
	readonly code = 'invalid-cookie'

	constructor(
		public key?: string,
		public response = key
			? `"${key}" is an invalid cookie`
			: 'Invalid Cookie',
		status?: number
	) {
		super(response)

		if (status) this.status = status as any
	}

	static signature(key: string) {
		return new InvalidCookie(key, `"${key}" has invalid cookie signature`)
	}

	static secret(
		key?: string
	): Omit<InvalidCookie, 'status'> & { status: 500 } {
		const advice = `${key ? `Cookie "${key}"` : 'A cookie'} is signed but \`cookie.secrets\` is missing or empty`

		const error = new InvalidCookie(
			key,
			isProduction() ? 'Internal Server Error' : advice,
			500
		)
		error.message = advice

		return error as any
	}
}
