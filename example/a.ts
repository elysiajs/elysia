import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('', 'a').listen(3000)

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
