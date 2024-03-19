import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const child = new Elysia({ precompile: true })
	.guard({
		cookie: t.Cookie(
			{
				accessToken: t.Optional(t.String())
			},
			{
				httpOnly: true,
				maxAge: 60 * 60 * 24 * 7, // 7 days
				sameSite: 'none',
				secure: true,
				secrets: 'a',
				sign: ['accessToken'],
				path: '/'
			}
		)
	})
	.get('/', ({ cookie: { accessToken } }) => {
		accessToken.value = 'a'

		return 'a'
	})

const app = new Elysia({ precompile: true })
	.use(child)
	.get('/outer', ({ cookie: { accessToken } }) => {
		accessToken.value = 'a'

		return 'a'
	})
	.listen(3000)

console.log(app.routes[1].composed?.toString())
