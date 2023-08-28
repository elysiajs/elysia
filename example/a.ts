import { Elysia, t, Context } from '../src'

const plugin = new Elysia()
	.group('/v1', (app) =>
		app
			.onBeforeHandle(() => {
				console.log('A')
			})
			.get('', () => 'A')
			.group('/v1', (app) =>
				app
					.onBeforeHandle(() => {
						console.log('B')
					})
					.get('/', () => 'B')
			)
	)

const app = new Elysia()
	.use(plugin)
	.get('/', () => 'A')
	.listen(8080)

console.log(app.routes)
