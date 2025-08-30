import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', function* () {
		for (let i = 0; i <= 100_000; i++) yield { hello: 'world' }
	})
	.listen(3000)

const q = app
	.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
