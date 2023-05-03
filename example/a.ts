import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/login', ({ body }) => body, {
		schema: {
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.onError(({ code, error, set }) => {
		console.log("Hi")

		if (code === 'VALIDATION') {
			set.status = 400

			return error.all().map((i) => ({
				filed: i.path.slice(1) || 'root',
				reason: i.message
			}))
		}
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
