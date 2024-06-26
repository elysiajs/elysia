import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().post('/', ({ body }) => body, {
	body: t.Optional(
		t.Array(
			t.Object({
				name: t.String({
					default: 'a'
				})
			}),
			{
				default: [
					{
						name: 'a'
					}
				]
			}
		)
	)
})

const res = await app.handle(post('/')).then((x) => x.json())

console.log({ res })
