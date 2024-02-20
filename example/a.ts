import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.resolve(() => ({
		hi: () => 'hi'
	}))
	.mapResolve((resolvers) => ({
		...resolvers,
		hi2: () => 'hi'
	}))
	.get('/', ({ hi }) => hi())
	.get('/h2', ({ hi2 }) => hi2())

const res = await app.handle(req('/')).then((t) => t.text())
const res2 = await app.handle(req('/h2')).then((t) => t.text())

console.log(res)
console.log(res2)
