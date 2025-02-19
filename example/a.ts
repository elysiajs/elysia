import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'*',
	async ({ query, request }) => {
		return {
			query,
			url: new URL(request.url).searchParams
		}
	},
	{
		query: t.Object({
			test: t.Union([t.Array(t.String()), t.String()])
		})
	}
)

app.handle(req('/?test=Test1%20%26%20Test2'))
	.then((x) => x.json())
	.then(console.log)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
