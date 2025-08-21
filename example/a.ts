import { Elysia, t, validationDetail } from '../src'

new Elysia()
	.onError(({ error, code }) => {
		if (code === 'VALIDATION') return error.detail(error.message)
	})
	.post('/', () => 'Hello World!', {
		body: t.Object({
			x: t.Number({
				error: 'x must be a number',
			})
		})
	})
	.listen(3000)
