import Elysia, { t } from '../src'

new Elysia()
	.post(
		'/mirror',
		async ({ status, body }) => status(201, { success: false }),
		{
			body: t.Object({
				code: t.String()
			}),
			response: {
				200: t.Object({
					success: t.Literal(true)
				}),
				201: t.Object({
					success: t.Literal(false)
				})
			}
		}
	)
	.listen(3333)
