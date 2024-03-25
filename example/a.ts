import { Elysia, t, ValidationError } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', ({ cookie }) => {
		cookie.auth.set({
			path: '/',
			value: Math.random().toString(),
			maxAge: 7 * 86400,
			secure: true,
			httpOnly: true
		})
	})
	.get('/remove', ({ cookie }) => {
		cookie.auth.remove()
	})
	.get('/value', ({ cookie }) => {
		return cookie.auth.value
	})
	.listen(3000)

// console.dir(app.routes, { depth: null })
