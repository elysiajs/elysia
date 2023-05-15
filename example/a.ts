import { Elysia, t } from '../src'

new Elysia()
	.use(async (app) => {
		await new Promise((resolve) => setTimeout(resolve, 1))

		return app.get('/', () => 'hi')
	})
	.listen(3000)
