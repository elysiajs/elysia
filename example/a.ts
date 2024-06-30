import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.mapResponse(() => {
		return new Response('b')
	})
	.get('/', () => 'a', {
		afterHandle() {
			return 'a'
		}
	})

app.handle(req('/'))
	.then((res) => res.text())
	.then(console.log)

console.log(app.routes[0].composed?.toString())