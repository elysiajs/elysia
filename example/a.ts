import { Elysia, sse, t } from '../src'

const a = t.Object({
	message: t.String(),
	image: t.Optional(t.Files())
})

new Elysia()
	.model({
		a
	})
	.post('/', ({ body }) => 'ok', {
		body: 'a'
	})
	.listen(3000)
