import KingWorld, { type TypedRoute, type Plugin } from '../src'

import S from 'fluent-json-schema'

const loggerPlugin: Plugin<
	{
		prefix?: string
	},
	{
		store: {
			fromPlugin: 'From Logger'
		}
		request: {
			log: () => void
		}
	}
> = (app, { prefix = '/fbk' } = {}) =>
	app
		.get('/hi', () => 'Hi')
		.state('fromPlugin', 'From Logger')
		.transform((request) => {
			request.log = () => {
				console.log('From Logger')
			}

			request.responseHeaders.append('X-POWERED-BY', 'KINGWORLD')
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
	.get('/', () => 'KINGWORLD')
	.use(loggerPlugin)
    .get("/tako", () => Bun.file('./example/takodachi.png'))
	.state('build', Date.now())
	.ref('date', () => Date.now())
	.get('/json', () => ({
		hi: 'world'
	}))
	.get('/wildcard/*', () => 'Hi Wildcard')
	.get<{
		query: {
			name: string
		}
	}>('/kw', (req, store) => 'KINGWORLD', {
		preHandler: ({ query, log }, { fromPlugin }) => {
			log()

			console.log('Name:', query?.name)

			if (query?.name === 'aom') return 'Hi saltyaom'
		}
	})
	.get<{
		params: {
			id: number
		}
	}>('/id/:id', (request, store) => request.params.id, {
		transform(request, store) {
			request.params.id = +request.params.id
		},
		schema: {
			params: S.object().prop('id', S.number().minimum(1).maximum(100))
		}
	})
	.post<{
		body: {
			username: string
		}
		params: {
			id: number
		}
	}>(
		'/new/:id',
		async ({ request, body, headers }) => {
			console.log('B', await body)

			return body
		},
		{
			schema: {
				body: S.object().prop(
					'username',
					S.string().required().minLength(5)
				)
			},
			preHandler: async () => {
				return 'Hi'
			}
		}
	)
	.group('/group', (app) => {
		app.preHandler<{
			query: {
				name: string
			}
		}>(({ query }) => {
			if (query?.name === 'aom') return 'Hi saltyaom'
		})
			.get('/hi', () => 'HI GROUP')
			.get('/kingworld', () => 'Welcome to KINGWORLD')
			.get('/fbk', () => 'FuBuKing')
	})
	.get('/build', (_, { build }) => build)
	.get('/ref', (_, { date }) => date)
	.get('/response', () => new Response('Hi'))
	.default(
		() =>
			new Response('Not Found :(', {
				status: 404
			})
	)
	.listen(8080)

console.log('🦊 KINGWORLD is running at :8080')
