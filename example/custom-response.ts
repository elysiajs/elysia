import { Elysia, t } from '../src'

const prettyJson = new Elysia()
	.guard({
		response: {
			200: t.String()
		}
	})
	.onAfterHandle(({ response }) => {
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
	.listen(3000)
