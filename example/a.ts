import { Elysia, ElysiaInstance } from '../src'
import { cookie } from '@elysiajs/cookie'
import { jwt } from '@elysiajs/jwt'

const a = cookie()
const b = jwt({
	name: 'jwt',
	secret: "A"
})

const app = new Elysia({
	prefix: '/api'
})
	.use(cookie())
	.get('/b', (c) => 'A')
	.listen(3000)
