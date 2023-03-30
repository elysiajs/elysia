import { Elysia, t } from '../src'

new Elysia()
	.onError(({ code, error, set }) => {
		if (code === 'NOT_FOUND') {
			set.status = 404

			return 'Not Found :('
		}

		if (code === 'VALIDATION') {
			set.status = 400

			return {
				fields: error.all()
			}
		}
	})
	.post('/a', () => 'hi', {
		schema: {
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.listen(8080)
