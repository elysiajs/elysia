import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ query }) => query)
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
