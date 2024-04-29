import { Elysia, t } from '../src'
import { req, post } from '../test/utils'

const app = new Elysia({ precompile: true }).post('/', ({ body }) => body ?? 'sucrose', {
	body: t.Optional(t.String())
})

console.log(app.routes[0].composed.toString())

app.handle(post('/', null))
	.then((x) => x.text())
	.then(console.log)
// .then(console.log)
