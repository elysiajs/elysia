import { Elysia, t } from '../src/2'

const app = new Elysia()
	.onBeforeHandle(() => {
		console.log('T')
	})
	.get('/:id/a', ({ body }) => {
		return body ?? 'Hello'
	})

console.log(app.routes[0].compile().toString())

Bun.serve({
	port: 3000,
	fetch: app.fetch
})
