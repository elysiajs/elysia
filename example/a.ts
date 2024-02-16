import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia()
	.get('/', () => true)
	.get('/true', () => true)
	.get('/true', () => true)
    .get('/false', () => false)
    .post('/mirror', ({ body }) => body)

type A = typeof app._routes.true.get.response
