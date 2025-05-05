import { Elysia, t } from '../src'

const app = new Elysia()
	.onError(({ code, error }) => {
		console.error('[error]', error)
		return { error: { code } }
	})
	.get(
		'/session',
		({ error, cookie: { sessionToken } }) => {
			const refreshed = !!sessionToken.value

			sessionToken.set({
				value: Math.random().toString(36).substring(2, 8),
				maxAge: 1000 * 60 * 60 * 24 * 7
			})

			if (refreshed) throw error('Unauthorized')

			return sessionToken.value
		},
		{
			cookie: t.Cookie(
				{ sessionToken: t.Optional(t.String()) },
				{
					sign: ['sessionToken'],
					secrets: 'my-secret'
				}
			)
		}
	)
	.listen(3000)

console.log(app.routes[0].compile().toString())
