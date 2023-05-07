import { Elysia } from '../src'

const app = new Elysia()
	.post('/body', (c) => c.body, {
		type: 'json'
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
