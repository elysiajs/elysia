import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.mapResponse(async ({ response }) => {})
	.get('/', async () => 'NOOP')
	.compile()

const res = await app.handle(req('/')).then((x) => x.text())

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)

// console.log(app.routes[0]?.composed?.toString())
