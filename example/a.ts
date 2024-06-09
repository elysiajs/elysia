import { Elysia } from '../dist'

new Elysia()
	.get('/', () => 'hello')
	.post('/body', ({ body }) => body)
	.listen(3000)
