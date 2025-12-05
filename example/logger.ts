import { Elysia } from '../src'
import { logger } from '../src/logger'

const app = new Elysia()
	.use(logger())
	.get('/', () => 'Hello World')
	.get('/users/:id', ({ params }) => `User ${params.id}`)
	.post('/users', () => ({ id: 1, name: 'John' }))
	.get('/health', () => 'OK')
	.listen(3333)

console.log('🦊 Server running at http://localhost:3333')
console.log('Try these endpoints:')
console.log('  GET  http://localhost:3000/')
console.log('  GET  http://localhost:3000/users/123')
console.log('  POST http://localhost:3000/users')
console.log('  GEeT  http://localhost:3000/health')
