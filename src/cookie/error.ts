import { ElysiaError } from '../error'

export class InvalidCookie extends ElysiaError {
	status = 400 as const
	problemType = 'invalid-cookie'
	problemTitle = 'Invalid Cookie'

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
		return new InvalidCookie(
			key,
			`${key ? `Cookie "${key}"` : 'A cookie'} is signed but \`cookie.secrets\` is missing or empty. Set it to a non-empty string: an empty secret signs with a zero-length key, which anyone can forge.`,
			500
		) as any
	}
}
