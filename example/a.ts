import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const model = new Elysia()
	.model({
		number: t.Number({ default: 0 })
	})

const app = new Elysia()
	.use(model)
	.post('/', ({ body }) => body, {
		body: t.Object({
			name: t.String(),
			amount: t.Optional(model.Ref('number'))
		})
	})

const result = await app
	.handle(
		post('/', {
			name: 'Jane Doe'
		})
	)
	.then((x) => x.json())

console.log(result)

// console.dir(
// 	t
// 		.Module({
// 			number: t.Numeric(),
// 			optionalNumber: t.Optional(t.Ref('number'))
// 		})
// 		.Import('optionalNumber'),
// 	{
// 		depth: null
// 	}
// )

// console.log(correct)
