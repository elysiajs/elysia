import { Value } from '@sinclair/typebox/value'
import { Elysia, t } from '../src'

const sessionName = 'user'

const app = new Elysia({
	cookie: {
		path: '/'
	}
})
	.model({
		a: t.String()
	})
	.guard({
		body: 'a',
		response: {
			401: 'a'
		}
	})
	.get('/a', ({ cookie: { session } }) => {
		return (session.value = 'abc')
	})
	.get('/b', ({ cookie: { session }, set }) => {
		const value = session.value

		session.remove()

		return 'v:' + value
	})
	.get('/async', async ({ error }) => {
		if (Math.random() > 0.5) return error(418)

		return 'ok'
	})
	.listen(3000)

app._routes.async
