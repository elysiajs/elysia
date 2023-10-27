import { Elysia } from '../src'

const app = new Elysia()
	.header({
		'X-Powered-By': 'Elysia'
	})
	.get('/', 'hi')
	.get('/id/:id', ({ params: { id } }) => 'hi')
	.listen(3000)

console.log(app.routes[0].composed?.toString())
