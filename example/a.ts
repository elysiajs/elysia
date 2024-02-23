import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.get('/0', () => '0')
	.get('/1', () => '1')
	.get('/2', () => '2')
	.get('/3', () => '3')
	.get('/1', () => '4')
	.get('/5', () => '5')

console.log(app.routes, app.routeTree)
