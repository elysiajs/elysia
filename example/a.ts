import { Elysia } from '../src'
import homepage from './index.html'

new Elysia()
	.get('/', homepage)
	.listen(3000, (server) => console.log(`Running on ${server.url}`))
