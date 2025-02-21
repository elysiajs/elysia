import { Elysia, t } from '../src'
import { req } from '../test/utils'

const asyncPlugin = Promise.resolve(new Elysia({ name: 'AsyncPlugin' }))

const plugin = new Elysia({ name: 'Plugin' })
	.use(asyncPlugin)
	.get('/plugin', () => 'GET /plugin')

const app = new Elysia({ name: 'App' })
	.use(plugin)
	.get('/foo', () => 'GET /foo')
	.listen(3000)

const response = await app.handle(new Request('http://localhost/plugin'))
const text = await response.text()
console.log(text) // 'GET /plugin'
