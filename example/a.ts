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
	.listen(3000)
