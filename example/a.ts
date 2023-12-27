import { Elysia, t } from '../src'
import { cors } from '@elysiajs/cors'

export const cache = () =>
	new Elysia({ name: 'cache' }).mapResponse(({ response }) => {
		return new Response('hello world')
	})

export default cache

const app = new Elysia()
	.use(cache)
	.get('/', () => 'A')
	.listen(3000)
