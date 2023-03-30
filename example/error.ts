import { Elysia, ValidationError } from '../src'

new Elysia()
	.onError(({ code, error, set }) => {
		if (code === 'NOT_FOUND')
			return new Response('Not Found :(', {
				status: 404
			})

		if (error instanceof ValidationError) {
			set.status = 400

			// return all invalid fields
			return {
				fields: error.all()
			}
		}
	})
	.get('/', () => {
		throw new Error('A')
	})
	.listen(8080)
