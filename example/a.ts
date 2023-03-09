import { Elysia, t, SCHEMA } from '../src'

const app = new Elysia()
	.group('/a', (app) =>
		app
			.derive(() => {
				return {
					hi: 'there'
				}
			})
			.get('/', (context) => {
				console.log(context)

				return 'a'
			})
	)
	.get('/hi', (context) => {
		console.log(context)

		return 'hi'
	})
	.listen(8080)
