import { Elysia } from '../src'

const server = 'https://lotto.api.rayriffy.com/'

const app = new Elysia()
	.post('/', function ({ body }) {
		return body
	})
	.listen(3000)
