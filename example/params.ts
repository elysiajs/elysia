import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => 'Elysia')
	// Retrieve params, automatically typed
	.get('/id/:id', ({ params }) => params.id)
	.listen(3000)

console.log('Listen')
