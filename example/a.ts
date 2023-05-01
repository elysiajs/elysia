import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', () => "hi")
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
