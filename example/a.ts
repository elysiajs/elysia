import { Elysia, t } from '../src'

const authenticate = (app: Elysia) =>
	app.group('/authenticate', (group) =>
		group.group('/a', (a) =>
			a
				.post(
					'/login',
					({ body: { username, password }, set }) => {
						set.status = 200
						return {
							status: 200,
							body: {
								username,
								password
							}
						}
					},
					{
						beforeHandle: ({
							body: { username, password },
							set
						}) => {
							throw new Error('This is a test')
						},
						schema: {
							body: t.Object({
								username: t.String(),
								password: t.String()
							})
						}
					}
				)
				.onError(({ code, error, set }) => {
					return {
						status: 400,
						body: {
							error: 'Bad request'
						}
					}
				})
		)
	)

const app = new Elysia()
	.use(authenticate)
	.get('/a', () => {
		throw new Error('A')
	})
	.onError(() => {
		console.log('B')
	})
	.listen(8080)
