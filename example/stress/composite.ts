import { Elysia, t } from '../../src'
import { run, bench, group, summary } from 'mitata'
import { profile } from './utils'

const auth = new Elysia({ name: 'auth' }).decorate('auth', {
	verify: () => true
})

const build = () => {
	const app = new Elysia()
		.use(auth)
		.derive(() => ({ user: { id: 1 } }))
		.guard({
			headers: t.Object({ authorization: t.Optional(t.String()) })
		})
		.beforeHandle(() => {})
		.get('/', () => 'ok')
		.get('/health', () => ({ ok: true }))

	for (let i = 0; i < 20; i++) app.get(`/static-${i}`, () => 'ok')

	for (let i = 0; i < 20; i++)
		app.get(`/res/${i}/:id`, ({ params: { id } }) => id, {
			params: t.Object({ id: t.Number() })
		})

	app.post('/users', ({ body }) => body, {
		body: t.Object({ name: t.String(), age: t.Number() }),
		response: t.Object({ name: t.String(), age: t.Number() })
	})

	app.get('/search', ({ query }) => query, {
		query: t.Object({ q: t.String(), page: t.Optional(t.Number()) })
	})

	return app
}

const stop = profile('Composite app: build + compile')
const app = build().compile()
stop()

const handle = app.handle
const body = JSON.stringify({ name: 'a', age: 1 })

summary(() => {
	group('composite throughput', () => {
		bench('GET / (derive+guard+global)', () =>
			handle(new Request('http://e.ly/'))
		)
		bench('GET /res/3/:id (dynamic+params)', () =>
			handle(new Request('http://e.ly/res/3/7'))
		)
		bench('POST /users (body+response)', () =>
			handle(
				new Request('http://e.ly/users', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body
				})
			)
		)
	})
})

await run()
