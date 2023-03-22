import { Elysia, t } from '../src'

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
	.listen(8080)
