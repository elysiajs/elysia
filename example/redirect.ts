import { Elysia } from '../src'

new Elysia()
	.get('/', () => 'Hi')
	.get('/redirect', ({ redirect }) => redirect('/'))
	.listen(3000)
