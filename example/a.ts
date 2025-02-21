import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.model({
		a: t.String(),
		myModel: t.Object({ num: t.Number(), a: t.Ref('a') })
	})
	.get(
		'/',
		({ query }) => {
			return query
		},
		{
			query: 'myModel'
		}
	)

app.handle(req('/?num=1&a=a'))
	.then((x) => x.text())
	.then(console.log)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
