import { Elysia } from '../src'

// Simple Hello World
const t1 = performance.now()
new Elysia()
	.get('/', () => 'Hi')
	.listen(3000)

console.log(performance.now() - t1)

// Bun.serve({
// 	port: 8080,
// 	fetch() {
// 		return new Response('Hi')
// 	}
// })

