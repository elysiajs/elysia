import { Elysia, t } from '../src'
import { Memoirist } from 'memoirist'

const app = new Elysia({
	systemRouter: true
})
	.onRequest(() => {
		console.log('hi')
	})
	.get('/', 'hi')
	.get('/id', ({ params }) => 'ok')
	.post('/id', 'a')
	.listen(3000)

Bun.serve({
	static: {
		'/': new Response("A")
	},
	routes: {},
	port: 3001,
	fetch(request) {
		return new Response("B")
	}
})
