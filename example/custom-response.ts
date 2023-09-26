import { Elysia } from '../src'

const prettyJson = new Elysia().onAfterHandle(({ response }) => {
	if (response instanceof Object)
		try {
			return JSON.stringify(response, null, 4)
		} catch {}
})

new Elysia()
	.use(prettyJson)
	.get('/', () => ({
		hello: 'world'
	}))
	.listen(8080)
