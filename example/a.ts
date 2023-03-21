import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'hi')
	.post('/a', ({ body }) => {
		console.log(body)
		
		return body
	}, {
		schema: {
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.listen(8080)
