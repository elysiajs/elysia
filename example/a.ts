import { Elysia, t } from '../src'
import { req } from '../test/utils'

const inner = new Elysia()
	.guard({
		response: t.Number(),
		as: 'global'
	})
	.get('/inner', () => 2)

const plugin = new Elysia()
	.use(inner)
	.guard({
		response: t.Boolean()
	})
	.get('/', () => true)

plugin._volatile

const app = new Elysia().use(plugin).get('/', () => 'ok')

app.handle(req('/plugin'))
	.then((x) => x.status)
	.then(console.log)
