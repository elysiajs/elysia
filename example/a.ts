import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'hello')
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
