import { Elysia } from '../src'

new Elysia()
	// ✅ easy to perform inference
	.get('/1', ({ query: { a } }) => a)
	// ❌ hard to perform inference
	.get('/2', ({ query }) => query.a)
	// ❌ hard to perform inference
	.get('/3', (c) => c.query.a)

addEventListener('fetch', (request) => {
	console.log(request)
})