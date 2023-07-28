import { Elysia, t } from '../src'

const app = new Elysia()
	.onRequest(() => {
		console.log('On Request')
	})
	.group(
		'/v1',
		{
			response: t.String()
		},
		(app) => app.get('/error', () => 1)
	)
	.listen(3000)
