import { Elysia } from '../src'

// Simple Hello World
new Elysia()
	.get('/', () => 'Hi')
	.listen(8080)
