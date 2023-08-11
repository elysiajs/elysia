import { Elysia } from '../src'

const plugin = new Elysia({
	prefix: '/folder'
})
	.get('/get', () => 'Test')
	.post('/post', () => 'Test')
	.put('/put', () => 'Test')
	.patch('/patch', () => 'Test')

const app = new Elysia({
	prefix: '/api'
})
	.use(plugin)
	.listen(3000)

const routes = app.routes
