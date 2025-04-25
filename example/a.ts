import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get(
		'/',
		() => ({
			type: 'stuff',
			data: {
				type: 'stuff',
				data: {
					type: 'stuff',
					data: null
				}
			}
		}),
		{
			response: t.Recursive((This) =>
				t.Object({
					type: t.String(),
					data: t.Nullable(This)
				})
			)
		}
	)
	.listen(3000)

// const res = await app.handle(req('/')).then((x) => x.json())
// console.log(res)

console.log(app.routes[0].compile().toString())
