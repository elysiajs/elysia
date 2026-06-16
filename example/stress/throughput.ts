import { Elysia, t } from '../../src'
import { run, bench, group, summary } from 'mitata'

const app = new Elysia()
	.get('/', () => 'ok')
	.get('/user/:id', ({ params: { id } }) => id)
	.post('/json', ({ body }) => body, {
		body: t.Object({ name: t.String(), age: t.Number() })
	})
	.get('/search', ({ query }) => query, {
		query: t.Object({ page: t.Number(), limit: t.Number() })
	})
	.get('/me', ({ cookie: { session } }) => session.value, {
		cookie: t.Object({ session: t.Optional(t.String()) })
	})

const handle = app.handle

const body = JSON.stringify({ name: 'saltyaom', age: 21 })
const post = () =>
	new Request('http://e.ly/json', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	})

await handle(new Request('http://e.ly/'))
await handle(new Request('http://e.ly/user/1'))
await handle(post())
await handle(new Request('http://e.ly/search?page=1&limit=10'))
await handle(
	new Request('http://e.ly/me', { headers: { cookie: 'session=abc' } })
)

summary(() => {
	group('throughput', () => {
		bench('GET / (plain)', () => handle(new Request('http://e.ly/')))
		bench('GET /user/:id (dynamic)', () =>
			handle(new Request('http://e.ly/user/42'))
		)
		bench('POST /json (body validate)', () => handle(post()))
		bench('GET /search (query coerce)', () =>
			handle(new Request('http://e.ly/search?page=2&limit=20'))
		)
		bench('GET /me (cookie)', () =>
			handle(
				new Request('http://e.ly/me', {
					headers: { cookie: 'session=abc' }
				})
			)
		)
	})
})

await run()
