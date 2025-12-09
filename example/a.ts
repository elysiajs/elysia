import { Elysia, t } from '../src'

new Elysia({ aot: false })
	.guard(
		{
			afterResponse: () => {
				console.log('afterResponse')
			}
		},
		(app) => app.get('/test', () => 'afterResponse')
	)
	.get('/', () => 'hi')
	.listen(3000)
