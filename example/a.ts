import { Elysia, t } from '../src'

const authenticate = (app: Elysia) =>
	app.group('/authenticate', (group) =>
		group
			.post(
				'/login',
				({ body: { username, password }, set }) => {
					throw new Error('Test')
				},
				{
					beforeHandle: ({ body: { username, password }, set }) => {
						// In development
					},
					schema: {
						body: t.Object({
							username: t.String(),
							password: t.String()
						}),
						response: t.Object({
							username: t.String(),
							password: t.String()
						})
					}
				}
			)
			.onError(({ code, error, set }) => {
				console.log(error)

				return {
					status: 400,
					body: {
						error: 'Bad request'
					}
				}
			})
	)

const app = new Elysia()
	.use(authenticate)
	.listen(8080)
