import { Elysia, t } from '../src'
import { expectTypeOf } from 'expect-type'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', ({ query }) => query, {
		query: t.Optional(
			t.Object({
				role: t.Optional(
					t.Array(
						t.Object({
							name: t.String()
						})
					)
				)
			})
		)
	})
	.compile()

app.handle(
	req(`/?role=${JSON.stringify([{ name: 'hello' }, { name: 'world' }])}`)
)
	.then((x) => x.json())
	.then(console.log)
