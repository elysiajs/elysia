import { Elysia } from '../src'
import { cors } from '@elysiajs/cors'

const app = new Elysia()
	.use(cors())
	.onRequest(({ set }) => {})
	.get('/', () => 'Hi')
	.listen(3000)
