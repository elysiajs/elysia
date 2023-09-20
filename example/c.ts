import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/0.6', ({ body }) => body, {
		body: t.Union([
			t.Undefined(),
			t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String())
			})
		])
	})
	.listen(3000)
