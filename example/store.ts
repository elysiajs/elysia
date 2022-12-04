import { Elysia } from '../src'

new Elysia()
	// Create globally mutable store
	.state('name', 'Fubuki')
	.get('/id/:id', ({ params: { id }, store: { name } }) => `${id} ${name}`)
