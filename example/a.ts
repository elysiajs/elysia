import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.guard({
		schema: 'standalone',
		body: t.Object({ id: t.Number() }),
		response: t.Object({ name: t.Literal('cantarella') })
	})
	.post(
		'/name/:name',
		({ body, params: { name } }) => ({
			...body,
			name: name as 'cantarella'
		}),
		{
			response: t.Object({ id: t.Number() })
		}
	)

const correct = await app.handle(
	post('/name/cantarella', {
		id: 1
	})
)

console.log(correct.status) // .toBe(200)
console.log(await correct.json()) // .toEqual({ id: 1, name: 'cantarella' })

const incorrect = await app.handle(
	post('/name/jinhsi', {
		id: 1
	})
)

console.log(incorrect.status) // .toBe(422)
