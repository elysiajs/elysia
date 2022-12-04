import { Elysia } from '../src'

new Elysia()
	.get('/', () => 'Hi')
	.get('/redirect', ({ set }) => {
		set.redirect = '/'
	})
	.listen(8080)
