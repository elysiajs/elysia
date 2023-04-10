import { Elysia, t } from '../src'

const loggerPlugin = (app: Elysia, { prefix = '/fbk' } = {}) =>
	app
		.get('/hi', () => 'Hi')
		.decorate('log', () => 'A')
		.decorate('date', () => new Date())
		.setStore('fromPlugin', 'From Logger')
		.use((app) => app.setStore('abc', 'abc'))

const app = new Elysia()
	.onRequest(({ set }) => {
		set.headers = {
			'Access-Control-Allow-Origin': '*'
		}
	})
	.use(loggerPlugin)
	.setStore('build', Date.now())
	.get('/', () => 'Elysia')
	.get('/tako', () => Bun.file('./example/takodachi.png'))
	.get('/json', () => ({
		hi: 'world'
	}))
	.get('/root/plugin/log', ({ log, store: { build } }) => {
		log()

		return build
	})
	.get('/wildcard/*', () => 'Hi Wildcard')
	.get('/query', () => 'Elysia', {
		beforeHandle: ({ query, log }) => {
			console.log('Name:', query?.name)

			if (query?.name === 'aom') return 'Hi saltyaom'
		},
		schema: {
			query: t.Object({
				name: t.String()
			})
		}
	})
	.post('/json', async ({ body }) => body, {
		schema: {
			body: t.Object({
				name: t.String(),
				additional: t.String()
			})
		}
	})
	.post('/transform-body', async ({ body }) => body, {
		beforeHandle: (ctx) => {
			ctx.body = {
				...ctx.body,
				additional: 'Elysia'
			}
		},
		schema: {
			body: t.Object({
				name: t.String(),
				additional: t.String()
			})
		}
	})
	.get('/id/:id', ({ params: { id } }) => id, {
		transform({ params }) {
			params.id = +params.id
		},
		schema: {
			params: t.Object({
				id: t.Number()
			})
		}
	})
	.post('/new/:id', async ({ body, params }) => body, {
		schema: {
			params: t.Object({
				id: t.Number()
			}),
			body: t.Object({
				username: t.String()
			})
		}
	})
	.get('/trailing-slash', () => 'A')
	.group('/group', (app) => {
		return app
			.onBeforeHandle<{
				query: {
					name: string
				}
			}>(({ query }) => {
				if (query?.name === 'aom') return 'Hi saltyaom'
			})
			.get('/', () => 'From Group')
			.get('/hi', () => 'HI GROUP')
			.get('/elysia', () => 'Welcome to Elysian Realm')
			.get('/fbk', () => 'FuBuKing')
	})
	.get('/response-header', ({ set }) => {
		set.status = 404
		set.headers['a'] = 'b'

		return 'A'
	})
	.get('/this/is/my/deep/nested/root', () => 'Hi')
	.get('/build', ({ store: { build } }) => build)
	.get('/ref', ({ date }) => date())
	.get('/response', () => new Response('Hi'))
	.get('/error', () => new Error('Something went wrong'))
	.get('/401', ({ set }) => {
		set.status = 401

		return 'Status should be 401'
	})
	.get('/timeout', async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000))

		return 'A'
	})
	.all('/all', () => 'hi')
	.onError(({ code, error, set }) => {
		if (code === 'NOT_FOUND') {
			set.status = 404

			return 'Not Found :('
		}
	})
	.listen(8080, ({ hostname, port }) => {
		console.log(`🦊 Elysia is running at http://${hostname}:${port}`)
	})
