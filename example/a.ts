import { Elysia, t } from '../src'

const a = new Elysia()
	.model({
		a: t.Object({
			a: t.Ref('a')
		}),
	})
	.get('/', ({ body: { a: { a: { a } } } }) => a, {
		body: 'a'
	})
