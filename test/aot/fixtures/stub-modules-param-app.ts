import { Elysia } from '../../../src'

// A dynamic path needs the radix router
export const app = new Elysia()
	.get('/', 'Hello World')
	.get('/id/:id', ({ params }) => params.id)
