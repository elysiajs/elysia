import { KingWorld, t, type KingWorldInstance } from '../src'

const loggerPlugin = (app: KingWorld, { prefix = '/fbk' } = {}) =>
	app
		.get('/hi', () => 'Hi')
		.decorate('log', () => 'A')
		.decorate('date', () => new Date())
		.state('fromPlugin', 'From Logger')
		.use((app) => app.state('abc', 'abc'))

const app = new KingWorld()
	.use(loggerPlugin)
	.state('build', Date.now())
	.get('/', () => 'KINGWORLD')
	.get('/tako', () => Bun.file('./example/takodachi.png'))
	.get('/json', () => ({
		hi: 'world'
	}))
	.get('/root/plugin/log', ({ log, store: { build } }) => {
		log()

		return build
	})
	.get('/wildcard/*', () => 'Hi Wildcard')
	.get('/kw', () => 'KINGWORLD', {
		beforeHandle: ({ query, log }) => {
			console.log('Name:', query?.name)

			if (query?.name === 'aom') return 'Hi saltyaom'
		},
		schema: {
			query: t.Object({
				name: t.Optional(t.String())
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
				additional: 'KingWorld'
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
		app.onBeforeHandle<{
			query: {
				name: string
			}
		}>(({ query }) => {
			if (query?.name === 'aom') return 'Hi saltyaom'
		})
			.get('/', () => 'From Group')
			.get('/hi', () => 'HI GROUP')
			.get('/kingworld', () => 'Welcome to KINGWORLD')
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
	.onError((error) => {
		console.log(error.code, error)

		if (error.code === 'NOT_FOUND')
			return new Response('Not Found :(', {
				status: 404
			})
	})
	.listen(8080, ({ hostname, port }) => {
		console.log(`🦊 KingWorld is running at http://${hostname}:${port}`)
	})
