import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/test',
	({ query: { id } }) => ({
		id,
		type: typeof id
	}),
	{
		query: t.Object({
			id: t
				.Transform(t.Array(t.UnionEnum(['test', 'foo'])))
				.Decode((id) => ({ value: id }))
				.Encode((id) => id.value)
		})
	}
)

app.handle(req('/test?id=test'))
	.then((x) =>
	x.json().then((v) =>
		console.dir(v, {
			depth: null
		})
	)
)
