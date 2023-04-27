import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ query }) => query)
	.post('/', ({ body }) => body)
	.listen(3000, ({ hostname, port }) => {
		// console.log(`Running at http://${hostname}:${port}`)
	})
