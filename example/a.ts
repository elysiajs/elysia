import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.derive(() => ({
		hi: () => 'hi'
	}))
	.get('/', ({ hi }) => hi())

console.log(app.router.history[0])

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
