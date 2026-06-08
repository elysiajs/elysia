import { Elysia, sse, t } from '../src'
import { streamResponse } from '../src/adapter/utils'

const asyncPlugin = async () =>
	new Elysia({ name: 'async' })
		.get('/router', () => 'OK')
		.get('/static', 'OK')

const app = new Elysia({ name: 'main' }).use(asyncPlugin()).listen(0)

await app.modules

console.log(app.routes)

console.log(app.server?.port)

const [router, _static] = await Promise.all([
	fetch(`http://localhost:${app.server?.port}/router`).then((x) => x.text()),
	fetch(`http://localhost:${app.server?.port}/static`).then((x) => x.text())
])

console.log(router)
console.log(_static)
