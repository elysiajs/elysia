import { Elysia } from '../src'

const app = new Elysia()
	.get('/', () => 'Hello')
	.listen(3000)
