import { Elysia, t } from '../src'

const app = new Elysia()
	// .get('/', 'hi')
	.header({
		'X-Powered-By': 'Elysia'
	})
	.get('/id/:id', ({ params: { id }, query: { a, b } }) => ({
		a,
		b
	}))
	.listen(3000)

console.log(app.routes[0].composed?.toString())
