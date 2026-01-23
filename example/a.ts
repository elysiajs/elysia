import { Elysia, t } from '../src'

const verifyToken = new Elysia()
	.macro('verifyToken', {
		headers: t.Object({
			authorization: t.String()
		}),
		resolve({ headers }) {
			// headers should be typed as { authorization: string }
			// but TypeScript shows: Record<string, string | undefined>
			const token = headers.authorization // Type is 'string | undefined', not 'string'
				? headers.authorization.substring(7)
				: undefined

			return { token }
		}
	})
	.get(
		'/',
		({ token }) => {},
		{
			verifyToken: true
		}
	)
