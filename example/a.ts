import { Elysia } from '../src'

const app = new Elysia({ precompile: true })
	.trace(async ({ set, beforeHandle }) => {
		const a = await beforeHandle
		await a.end
	})
	.guard(
		{
			beforeHandle({ error }) {
				return error(403, 'You should get this error.')
			}
		},
		(app) => app.get('/reject', () => "You shouldn't be here!")
	)
	.compile()
	.listen(3000)
