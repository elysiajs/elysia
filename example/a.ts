import { Elysia, t } from '../src'

new Elysia()
	.post('/', ({ body }) => body, {
		parse(context) {
			return context.request.json().then(() => 'hi')
		}
	})
	.listen(3000)
