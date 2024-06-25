import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.get('/', ({ query }) => query)
	.listen(3000)

app.handle(new Request('http://localhost/?name=ely+sia'))
	.then((t) => t.text())
	.then(console.log)

console.log(app.routes[0].composed?.toString())
