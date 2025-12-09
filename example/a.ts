import { Elysia } from '../src'

const app = new Elysia()
	.group('', (app) => {
		return app.get('/ok', () => 'Hello World')
	})
	.listen(3000)

type Routes = keyof typeof app['~Routes']
