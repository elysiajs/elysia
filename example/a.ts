import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ request }) => {
		request.url
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())
