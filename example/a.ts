import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const elysia1 = new Elysia()
const elysia2 = new Elysia()
const elysia3 = new Elysia()

elysia3.get('/foo', () => 'foo')
elysia2.use(elysia3)
elysia1.use(elysia2)

console.log(elysia1.routes)

elysia1.handle(
	req('/foo')
)
	.then((x) => x.text())
	.then(console.log)
