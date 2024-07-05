import { Elysia, replaceSchemaType, t } from '../src'
import { TypeCompiler } from '../src/type-system'
import { post, req } from '../test/utils'

// const a = TypeCompiler.Compile(
// 	replaceSchemaType(t.Array(t.String()), {
// 		from: t.Array(t.Any()),
// 		to: () => t.ArrayString(t.Any())
// 	})
// )

// console.log(a.Decode(JSON.stringify(['a', 'b'])))

const app = new Elysia().get(
	'/council',
	({ cookie: { council } }) => council.value = { id: 'a' },
	{
		cookie: t.Object({
			council: t.Object({
				id: t.String()
			})
		})
	}
)

const response = await app
	.handle(
		req('/council', {
			headers: {
				cookie: 'council=' + encodeURIComponent(JSON.stringify({ id: 'a' }))
			}
		})
	)
	.then((x) => x.json())

console.log(response)
