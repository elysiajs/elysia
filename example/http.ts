import KingWorld from '../src'
import { KingWorldInstance } from '../src/types'

const loggerPlugin = (app: KingWorld, { prefix = '/fbk' } = {}) =>
	app
		.get('/hi', () => 'Hi')
		.decorate('ab', () => 'A')
		.state('fromPlugin', 'From Logger')
		.use((app) => app.state('abc', 'abc'))

new KingWorld()
	.use(loggerPlugin)
	.state('build', Date.now())
	.get('/', () => 'KINGWORLD')
	.get('/tako', () => Bun.file('./example/takodachi.png'))
	.get('/json', () => ({
		hi: 'world'
	}))
	.get('/root/plugin/log', ({ log, store: { a } }) => {
		log()

		return a('B')
	})
	.get('/wildcard/*', () => 'Hi Wildcard')
	.get<{
		query: {
			name: string
		}
	}>('/kw', () => 'KINGWORLD', {
		preHandler: ({ query, log }) => {
			console.log('Name:', query?.name)

			if (query?.name === 'aom') return 'Hi saltyaom'
		}
	})
	.post<{
		body: {
			name: string
			additional: String
		}
	}>('/json', async ({ body }) => body)
	.post<{
		body: {
			name: string
			additional: String
		}
	}>('/transform-body', async ({ body }) => body, {
		preHandler: (ctx) => {
			ctx.body = {
				...ctx.body,
				additional: 'KingWorld'
			}
		}
	})
	.get<{
		params: {
			id: number
		}
	}>('/id/:id', ({ params: { id } }) => id, {
		transform({ params }) {
			params.id = +params.id
		}
	})
	.post<{
		body: {
			username: string
		}
		params: {
			id: number
		}
	}>('/new/:id', async ({ body, params }) => body)
	.get('/trailing-slash', () => 'A')
	.group('/group', (app) => {
		app.preHandler<{
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
	.get('/response-header', ({ status, responseHeaders }) => {
		status(404)
		responseHeaders['a'] = 'b'

		return 'A'
	})
	.get('/this/is/my/deep/nested/root', () => 'Hi')
	.get('/build', ({ store: { build } }) => build)
	.get('/ref', ({ store: { date } }) => date)
	.get('/response', () => new Response('Hi'))
	.get('/error', () => new Error('Something went wrong'))
	.get('/401', ({ status }) => {
		status(401)

		return 'Status should be 401'
	})
	.get('/timeout', async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000))

		return 'A'
	})
	.use((app) => {
		console.log('Store', app.store)

		return app
	})
	.onError((error) => {
		console.log("HANDLE ER")

		if (error.code === 'NOT_FOUND')
			return new Response('Not Found :(', {
				status: 404
			})
	})
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
