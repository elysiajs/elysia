import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.compile()

// console.log(app.fetch.toString())

// console.log(app)

// console.log(app.routes[0].composed?.toString())

app.handle(req('/'))
	.then((x) => x.headers)
	.then(console.log)
