import { Elysia, t } from '../src'
import { req } from '../test/utils'

const inner = new Elysia()
	.guard({
		as: 'global',
		response: t.Number(),
	})
	.get('/inner', () => 2)

const plugin = new Elysia()
	.use(inner)
	.guard({
		response: t.Boolean()
	})
	.get('/', () => true)

const app = new Elysia()
	.use(plugin)
	// @ts-expect-error
	.get('/', () => 'not a number')

app.handle(req('/'))
	.then((x) => x.status)
