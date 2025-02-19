import { Elysia } from '../src'

const asyncPlugin = Promise.resolve(new Elysia({ name: 'AsyncPlugin' }))

const plugin = new Elysia({ name: 'Plugin' })
	.use(asyncPlugin)
	.get('/plugin', () => {
		console.log('PLUGIN')
		return 'GET /plugin'
	})

const app = new Elysia({ name: 'App' })
	.use(plugin)
	.get('/foo', ({ path }) => {
		console.log('FOO')
		return 'GET /foo'
	})
	.listen(3000)

await app.modules

// console.log(app.routes.map((x) => [x.path, x.handler.toString()]))
// console.log(app.fetch.toString())

const response = await app.handle(new Request('http://localhost/plugin'))
const text = await response.text()
console.log('?', text)
