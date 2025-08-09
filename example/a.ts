import { Elysia } from '../src'

new Elysia()
	.get('/', ({ cookie: { foo, baz }, set }) => {
		foo.value = 'foo'
		baz.value = 'baz'

		return Bun.file('./package.json')
	})
	.listen(3000)
