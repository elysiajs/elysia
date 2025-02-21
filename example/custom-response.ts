import { Elysia } from '../src'

const prettyJson = new Elysia()
	.mapResponse(({ response }) => {
		if (response instanceof Object)
			return new Response(JSON.stringify(response, null, 4))
	})
	.as('plugin')

new Elysia()
	.use(prettyJson)
	.get('/', () => ({
		hello: 'world'
	}))
	.listen(3000)
