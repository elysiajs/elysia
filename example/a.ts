import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body }) => body, {
		type: 'json'
	})
	.listen(3000)
