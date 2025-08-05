import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body }) => body, {
		body: t.Object(
			{
				name: t.Optional(t.String()),
				description: t.Optional(t.String())
			},
			{ minProperties: 1 }
		)
	})
	.listen(3000)
