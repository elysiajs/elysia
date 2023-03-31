import { Elysia, t } from '../src'

const app = new Elysia()
	.group('/v1', (app) => app.decorate('a', 'b').get('/', ({ a }) => a))
	.listen(8080)
