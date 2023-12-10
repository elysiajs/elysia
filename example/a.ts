import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', () => 'NOOP', {
	mapResponse() {
		return new Response('A')
	}
})

console.log(app.routes[0].composed?.toString())

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
