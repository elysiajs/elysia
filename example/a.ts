import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.model({
		string: t.String()
	})
	.get('/', () => ({ a: 'a' }), {
		response: t.Object({
			a: t.Ref('string')
		})
	})
	.listen(3000)

// console.log(app.models)

app.handle(req('/'))
	.then((x) => x.json())
	.then(console.log)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
