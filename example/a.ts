import { Elysia, t, error } from '../src'
import { post, req } from '../test/utils'

const called = <string[]>[]

const app = new Elysia({ precompile: true })
	.post(
		'/json',
		({ body }) => {
			return 'a'
		},
		{
			type: 'json'
		}
	)
	.listen(3000)

app.handle(
	new Request('https://localhost:3000/json', {
		method: 'POST',
		body: 'a'
	})
)
	.then((x) => x.text())
	.then(console.log)

console.log(app.routes[0].composed?.toString())