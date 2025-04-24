import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia({
	sanitize: (v) => v && 'Elysia'
})
	.get(
		'/',
		() => ({
			type: 'ok',
			data: [
				{
					type: 'cool',
					data: null
				},
				{
					type: 'yea',
					data: {
						type: 'aight',
						data: null
					}
				}
			]
		}),
		{
			response: t.Recursive((This) =>
				t.Object({
					type: t.String(),
					data: t.Union([t.Nullable(This), t.Array(This)])
				})
			)
		}
	)
	.listen(3000)

app.handle(req('/'))
	.then((x) => x.json())
	.then((x) => console.dir(x, { depth: null }))
