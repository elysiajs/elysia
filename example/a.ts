import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ query: { name } }) => name)
	.onStart((app) => {
		console.log("App started", app.server?.hostname)
	})
	.listen(3000)
