import { Elysia } from '../src'

// Simple Hello World
new Elysia()
	.get('/', () => 'Hi')
	.onStart(() => {
		console.log('🦊 KINGWORLD is running at :8080')
	})
	.listen(8080)
