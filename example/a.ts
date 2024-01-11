import { Elysia, t } from '../src'
import { parseCookie } from '../src/cookie'
import { req } from '../test/utils'

const app = new Elysia()
	.onTransform(({ set }) => {
		set.headers['x-powered-by'] = 'Elysia'
	})
	.get('/', () => 'Hi')

const headers = await app.handle(req('/')).then((x) => x.headers.toJSON())

// console.log(headers)
// console.log(app.routes[0].composed?.toString())
