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
		if (key)
			return new InvalidCookie(
				key,
				`"${key}" is signed but no secret is provided`,
				500
			) as any

		return new InvalidCookie(
			undefined,
			`Cookie is signed but no secret is provided`,
			500
		) as any
	}
}
