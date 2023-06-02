import { Elysia } from '../src'
import { cors } from '@elysiajs/cors'

const server = 'https://lotto.api.rayriffy.com/'

const app = new Elysia()
	.use(cors())
	.onRequest(({ request }) => {
		console.log(request)

		return request
	})
	.post('/', function ({ body }) {
		return body
	})
	.listen(3000)
