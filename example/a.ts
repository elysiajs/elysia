import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({query}) => {
	console.log("Query:", query)

	return query
})

app.handle(req('/?id=a'))
	.then((x) => x.json())
	.then(console.log)
