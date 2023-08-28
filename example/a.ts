import { Elysia } from '../src'

const app = new Elysia()
	.use(
		new Elysia({ prefix: '/test', scoped: true })
			.derive(() => {
				console.log('test')
				return { test: 'test' }
			})
			.get('/', ({ test }) => test)
	)
	.use(new Elysia({ prefix: '/asdf' }).get('/', () => 'asdf'))

new Elysia().use(app).listen(3000)
