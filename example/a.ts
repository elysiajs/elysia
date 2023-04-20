import { Elysia, t } from '../src'

const signInDTO = t.Object({
	username: t.String(),
	password: t.String()
})

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	.onTransform(() => {
		console.log('Hi')
	})
	.group('/auth', (app) =>
		app.guard(
			{
				schema: {
					body: signInDTO
				}
			},
			(app) =>
				app
					.post('/sign-in', async ({ body }) => {
						const result = {
							success: false
						}

						if (!result.success) {
							// this logs
							console.log('before hook?')
							throw new Error() // this error should activate the onError right?
						}

						return result
					})
					.onError(({ error, set, request, code }) => {
						// I am not getting any logs
						console.log('onError!')

						set.status = 404

						console.log('code', code)
						console.log('error', error)
						console.log('request', request)
						return 'HA?'
					})
		)
	)
	.listen(3000)
