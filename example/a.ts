import { Elysia, t } from '../src'
import { hasTransform } from '../src/compose'
import { post } from '../test/utils'

console.log(
	hasTransform(
		t
			.Transform(
				t.Object({
					name: t.String()
				})
			)
			.Decode((x) => x.name)
			.Encode((x) => ({ name: x }))
	)
)

const app = new Elysia().post('/', ({ body }) => body, {
	body: t
		.Transform(
			t.Object({
				name: t.String()
			})
		)
		.Decode((x) => x.name)
		.Encode((x) => ({ name: x })),
	response: t.String()
})

const res = await app.handle(post('/', { name: 'difhel' }))

console.log(await res.text()) //.toBe('difhel')
console.log(res.status) //.toBe(200)
