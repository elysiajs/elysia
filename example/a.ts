import { Elysia, t } from '../src'

const plugin = new Elysia({ prefix: '/hello' }).get('/', () => 'A')

const app = new Elysia()
	.get('/', () => 'A')
	.use(plugin)
	.listen(3000)

const a = app.routes