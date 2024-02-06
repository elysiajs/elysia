import { Elysia } from '../src'

const app = new Elysia()

const plugin = new Elysia({
	prefix: '/plugin',
	scoped: true
}).get('/testPrivate', () => 'OK')

const plugin2 = new Elysia({
	prefix: '/plugindeep',
	scoped: true
}).get('/testPrivate', () => 'OK')

app.use(plugin).use(plugin2)

app.listen(9001)
