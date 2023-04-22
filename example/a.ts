import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/1', ({ set }) => {
		set.headers['x-server'] = 'Elysia'

		return 'hi'
	})
	.get('/2', () => 'hi')
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
