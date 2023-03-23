import { Elysia, t, EXPOSED } from '../src'

const app = new Elysia()
	.setModel({
		number: t.Number()
	})
	.post(
		'/',
		({ set, body: { status, response } }) => {
			set.status = status

			return response
		},
		{
			schema: {
				body: t.Object({
					status: t.Number(),
					response: t.Any()
				}),
				response: {
					200: t.String(),
					201: t.Number()
				}
			}
		}
	)
	.fn({
		sum: (a: number, b: number) => a + b
	})
	.listen(8080)
