import { Elysia, t } from '../src'

const a = new Elysia()
	.model({
		a: t.Object({
			a: t.Ref('a')
		}),
	})
	.model((model) => ({
		...model,
		b: t.Object({
			a: model.a,
			b: t.Ref('b')
		})
	}))
	.get('/', () => 'a', {
		query: t.Object({
			a: t.String()
		})
	})
	.listen(3000)

a._routes.index.get.response[422].
