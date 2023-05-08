import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => {
		throw new Error('Unknown error: Hi')
	})
	.get('/id/:id', (ctx) => {
		ctx.set.headers['x-powered-by'] = 'benchmark'

		return `${ctx.params.id} ${ctx.query.name}`
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
