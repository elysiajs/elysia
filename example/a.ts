import { Elysia, t } from '../src'

const app = new Elysia()
	.model({
		myModel: t.Object({ num: t.Number() })
	})
	.get(
		'/',
		({ query: { num } }) => ({ num, type: typeof num }),
		{
			query: 'myModel'
		}
	)
	.listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
