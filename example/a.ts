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
	.get('/inner', () => 'ok')

const plugin = new Elysia()
	.use(inner)
	// ? Local override
	.guard({
		response: {
			401: t.Boolean()
		}
	})
	.get('/plugin', ({ error }) => error(401, 1))

const app = new Elysia()
	.use(plugin)
	.get('/', ({ error }) => error(401, 1))

app.handle(req('/plugin'))
	.then((x) => x.status)
	.then(console.log)
