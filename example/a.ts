import { Elysia, t } from '../src'
import { hasRef, hasTransform } from '../src/compose'
import { req } from '../test/utils'

const app = new Elysia().post('/test', ({ body }) => body, {
	body: t.Intersect([
		t.Object({ foo: t.String() }),
		t.Object({
			field: t
				.Transform(t.String())
				.Decode((decoded) => ({ decoded }))
				.Encode((v) => v.decoded)
		})
	])
})

app.handle(
	new Request('http://localhost/test', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ field: 'bar', foo: 'test' })
	})
)
	.then((x) => x.json())
	.then(console.log)
