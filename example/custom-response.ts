import { Elysia } from '../src'

// This plugin will format JSON before return response
const prettyJson = (app: Elysia) =>
	// Custom
	app.onAfterHandle((response, context) => {
		if (response instanceof Object)
			try {
				return JSON.stringify(response, null, 4)
			} catch (error) {
				return
			}
	})

new Elysia()
	.use(prettyJson)
	.get('/', () => ({
		hello: 'world'
	}))
	.listen(8080)
