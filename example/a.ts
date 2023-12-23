import { Elysia, t } from '../src'

export const cache = () =>
	new Elysia({ name: 'cache' }).mapResponse(({ response }) => {
		return new Response('hello world')
	})

export default cache

const app = new Elysia()
	.use(cache)
	.get('/', ({ query: { name } }) => name)
	.onStart((app) => {
		console.log('App started', app.server?.hostname)
	})
	.listen(3000)
