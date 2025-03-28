import { Elysia, t } from '../src'

const app = new Elysia()
	// .guard({
	// 	schema: 'standalone',
	// 	body: t.Object({ id: t.Number() }),
	// 	response: t.Object({ success: t.Boolean() })
	// })
	// .guard({
	// 	schema: 'standalone',
	// 	body: t.Object({ separated: t.Literal(true) })
	// })
	.post(
		'/',
		({ body }) => ({
			success: true,
			id: 1,
			name: body.name
		}),
		{
			body: t.Object({ name: t.Literal('saltyaom') }),
			response: t.Object({ id: t.Number() })
		}
	)
	.listen(3000)
