import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.guard({
		headers: t.Object({
			token: t.String()
		})
	})
	.derive(({ headers: { token } }) => {
		return { token: token.split(' ')[1] }
	})
	.get('/token', ({ token }) => token)

console.log(app.routes[0].composed?.toString())

const correct = await app
	.handle(
		req('/token', {
			headers: { token: 'Bearer 1234' }
		})
	)
	.then((x) => x.text())

const error = await app.handle(req('/token')).then((x) => x.text())

console.log(correct)
console.log(error)
