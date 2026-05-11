import { Elysia, t } from '../src'

new Elysia()
	.get('/', () => 'Hello World')
	.listen(3000)
