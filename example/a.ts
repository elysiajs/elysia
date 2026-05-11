import { Elysia, t } from '../src'

new Elysia()
	.get('/y a y', () => 'Hello World')
	.listen(3000)
