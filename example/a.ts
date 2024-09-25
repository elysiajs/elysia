import { Elysia } from '../src'

const p1 = new Elysia().state('a', 'a')
const p2 = new Elysia().state('b', 'b')

new Elysia()
	.use([p1, p2])
	.get('/', ({ store }) => store.b)
