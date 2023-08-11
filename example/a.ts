import { Elysia } from '../src'

const plugin = new Elysia({
	prefix: '/plugin'
}).get('/test-path', () => 'Test')

const app = new Elysia({
	prefix: '/api'
})
	.use(plugin)
	.listen(3000)

const routes = app.routes