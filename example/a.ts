import { Elysia, t } from '../src'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		test: t.Optional(t.Number()),
		$test: t.Optional(t.Number())
	})
})

const value = app.handle(new Request('http://localhost?test=1&%24test=2'))
	.then((x) => x.json())
