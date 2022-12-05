import { Elysia, t } from '../src'

new Elysia()
	.onError((code, error) => {
		if (code === 'NOT_FOUND')
			return new Response('Not Found :(', {
				status: 404
			})
	})
	.get('/', () => {
		throw new Error('A')
	})
	.listen(8080)
