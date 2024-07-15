import { Elysia, t } from '../src'
import { req } from '../test/utils'

const inner = new Elysia()
	.guard({
		as: 'global',
		response: {
			401: t.Number(),
			402: t.Number()
		}
	})
	.get('/inner', () => '')

const plugin = new Elysia()
	.use(inner)
	.guard({
		response: {
			401: t.Boolean()
		}
	})
	.get('/plugin', ({ error }) => {
		error('Payment Required', 20)
		return error(401, true)
	})

const app = new Elysia()
	.use(plugin)
	.get('/', () => 'ok')

app.handle(req('/plugin'))
	.then((x) => x.status)
	.then(console.log)
