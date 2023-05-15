import { Elysia, t } from '../src'

const app = new Elysia()
	.onParse((request, contentType) => {
		if (contentType === 'application/elysia') return 'hi'
	})
	.post('/', ({ body }) => body, {
		body: t.String()
	})
	.listen(3000)