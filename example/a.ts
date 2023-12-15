import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.mapResponse(() => {
		return new Response('hello')
	})
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.compile()

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)

console.log(app.routes[0]?.composed?.toString())
