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
		app.get(
			`/res/${i}/:id`,
			{
				params: t.Object({ id: t.Number() })
			},
			({ params: { id } }) => id
		)

	app.post(
		'/users',
		{
			body: t.Object({ name: t.String(), age: t.Number() }),
			response: t.Object({ name: t.String(), age: t.Number() })
		},
		({ body }) => body
	)

	app.get(
		'/search',
		{
			query: t.Object({ q: t.String(), page: t.Optional(t.Number()) })
		},
		({ query }) => query
	)

	return app
}

const stop = profile('Composite app: build + compile')
const app = build().compile()
stop()

const handle = app.handle
const body = JSON.stringify({ name: 'a', age: 1 })

// Reuse no-body Requests so the op measures framework dispatch, not `new Request`.
const getRoot = new Request('http://e.ly/')
const getRes = new Request('http://e.ly/res/3/7')

summary(() => {
	group('composite throughput', () => {
		bench('GET / (derive+guard+global)', () => handle(getRoot))
		bench('GET /res/3/:id (dynamic+params)', () => handle(getRes))
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
