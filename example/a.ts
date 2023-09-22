import { Elysia, t } from '../src'

const plugin = async () => new Elysia().get('/', () => 'A')

const app = new Elysia()
	.use(plugin())
	.listen(3000)

console.log(app.routes)

type App = typeof app
