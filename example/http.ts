import KingWorld, { type TypedRoute, type Plugin } from '../src'

import S from 'fluent-json-schema'

const loggerPlugin: Plugin<
	{
		prefix?: string
	},
	{
		store: {
			fromPlugin: 'From Logger'
			log: () => void
		}
	}
> = (app, { prefix = '/fbk' } = {}) =>
	app
		.get('/hi', () => 'Hi')
		.state('fromPlugin', 'From Logger')
		.transform(({ responseHeaders }, store) => {
			store.log = () => {
				console.log('From Logger')
			}

			responseHeaders.append('X-POWERED-BY', 'KINGWORLD')
		})
		.group(prefix, (app) => {
			app.get('/plugin', () => 'From Plugin')
		})

const app = new KingWorld<{
	store: {
		build: number
		date: number
	}
}>()
	.use(loggerPlugin)
	.state('build', Date.now())
	.ref('date', () => Date.now())
	.refFn('a', (a: string) => a)
	.get('/', () => 'KINGWORLD')
	.get('/tako', () => Bun.file('./example/takodachi.png'))
	.get('/json', () => ({
		hi: 'world'
	}))
	.get('/root/plugin/log', (_, { log, a }) => {
		log()

		return a('B')
	})
	.get('/wildcard/*', () => 'Hi Wildcard')
	.get<{
		query: {
			name: string
		}
	}>('/kw', (ctx, store) => 'KINGWORLD', {
		preHandler: ({ query }, { fromPlugin, log }) => {
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
	}>('/id/:id', (request, store) => request.params.id, {
		transform({ params }, store) {
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
	}>('/new/:id', async ({ body }) => body)
	.get("/trailing-slash", () => "A")
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
		responseHeaders.append('a', 'b')

		// console.log(r.status)

		return 'A'
	})
	.get('/this/is/my/deep/nested/root', () => 'Hi')
	.get('/build', (_, { build }) => build)
	.get('/ref', (_, { date }) => date)
	.get('/response', () => new Response('Hi'))
	.get('/error', () => new Error('Something went wrong'))
	.get('/401', ({ status }) => {
		status(401)

		return 'Status should be 401'
	})
	.use((app) => {
		console.log('Store', app.store)

		return app
	})
	.default(
		() =>
			new Response('Not Found :(', {
				status: 404
			})
	)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
