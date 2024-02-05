import { Elysia, t } from '../src'

const a1 = new Elysia().state('a', 'a').get('a', 'a')
const a2 = new Elysia().state('b', 'b').get('b', 'b')

const app = new Elysia()
	.use([a1, a2])
	.get('', ({ store: { a, b } }) => a + b)
	.get('/id/:id', ({ params: { id } }) => id)
	.listen(3000)
