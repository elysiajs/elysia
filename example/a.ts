import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/id/:id', ({ request }) => {
		console.log(request)

		return 'a'
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
