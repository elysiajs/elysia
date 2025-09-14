import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia()
	.model({
		q: t.Number(),
		number: t.Object({
			value: t.Number(),
			number: t.Ref('q')
		})
	})
	.post('/', ({ body }) => body, { body: 'number' })

const result = await app
	.handle(post('/', {
		value: '1',
		number: '2'
	}))
	.then((x) => x.text())
	.then(console.log)
