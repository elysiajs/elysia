import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	() => {
		return {
			message: 'Hello World!'
		}
	},
	{
		response: t.Object({
			message: t.String()
		})
	}
)

app.listen(3000, ({ hostname, port }) => {
	console.log(`🦊 running at http://${hostname}:${port}`)
})
  // Trigger the request
	.handle(req('/'))
	.then((res) => res.json())
	.then(console.log)
