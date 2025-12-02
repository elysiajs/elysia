import { Elysia, t } from '../src'
import * as z from 'zod'
import { post, req } from '../test/utils'

const app = new Elysia({
	cookie: { secrets: 'secrets', sign: 'session' }
})
	.onError(({ code, error }) => {
		console.log({ code })

		if (code === 'INVALID_COOKIE_SIGNATURE')
			return 'Where is the signature?'
	})
	.get('/', ({ cookie: { session } }) => 'awd')

console.log(app.routes[0].compile().toString())

const root = await app.handle(
	new Request('http://localhost/', {
		headers: {
			Cookie: 'session=1234'
		}
	})
)

console.log(await root.text())
