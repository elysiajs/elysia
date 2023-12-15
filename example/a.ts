import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', Bun.file('test/kyuukurarin.mp4'))
	.compile()

app.handle(req('/'))
	.then((x) => x.headers)
	.then(console.log)
