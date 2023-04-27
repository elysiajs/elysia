import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ body }) => {
		return body
	})
	.post('/8', () => 'hi', {
		afterHandle({ body }) {
			// not empty
		}
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
