import { Elysia, t } from '../src'

const authenticate = (app: Elysia) =>
	app.group('/authenticate', (group) =>
		group
			.post(
				'/login',
				({ body: { username, password }, set }) => {
					throw new Error('A')
				},
				{
					beforeHandle: ({ body: { username, password }, set }) => {},
					schema: {
						body: t.Object({
							username: t.String(),
							password: t.String()
						})
					}
				}
			)
			.onError(({ code, error, set }) => {
				console.log("A")

				return {
					status: 400,
					body: {
						error: 'Bad request'
					}
				}
			})
	)

const app = new Elysia().use(authenticate).listen(8080)
