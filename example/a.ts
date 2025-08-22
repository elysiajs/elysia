import { Elysia, sse, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	() => ({
		hasMore: true,
		total: 1,
		offset: 0,
		totalPages: 1,
		currentPage: 1,
		items: [{ username: 'Bob', secret: 'shhh' }]
	}),
	{
		response: t.Object({
			hasMore: t.Boolean(),
			items: t.Array(
				t.Object({
					username: t.String()
				})
			),
			total: t
				.Transform(t.Number())
				.Decode((x) => x)
				.Encode((x) => x),
			offset: t.Number({ minimum: 0 }),
			totalPages: t.Number(),
			currentPage: t.Number({ minimum: 1 })
		})
	}
)
.listen(3000)

const data = await app.handle(req('/')).then((x) => x.text())
