import { Elysia, t } from '../src'

const app = new Elysia()
	.onError(({ code }) => {
		console.log('[onError]', code)
		return { error: { code } }
	})
	.get(
		'/bug',
		async ({ cookie }) => {
			if (!cookie.bug.value) {
				cookie.bug.value = new Date().toISOString()
			}
			return { value: cookie.bug.value }
		},
		{
			cookie: t.Cookie(
				{ bug: t.Optional(t.String()) },
				{ secrets: crypto.randomUUID(), sign: ['bug'] }
			)
		}
	)
	.get('/crash', async () => {
		throw new Error('something')
	})
	.listen(3000)
