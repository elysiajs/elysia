import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.onRequest(() => 'a')
	.get('/:hash', async ({ params: { hash }, error, set }) => {
		const file = Bun.file('example/teapot.webp')

		return file
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
