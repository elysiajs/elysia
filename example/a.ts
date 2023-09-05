import Elysia from '../src'

new Elysia()
	.get('/', ({ set }) => {
		set.status = "I'm a teapot"

		return Bun.file('example/teapot.webp')
	})
	.listen(3000)
