import { Elysia, t } from '../src'
import { mergeDeep } from '../src/utils'

console.log(
	mergeDeep(
		{
			tags: ['a']
		},
		{
			tags: ['b']
		}
	)
)

const app = new Elysia()
	.macro({
		sartre: {
			body: t.Object({ sartre: t.Literal('Sartre') })
		},
		focou: {
			sartre: true,
			body: t.Object({ focou: t.Literal('Focou') })
		},
		lilith: {
			sartre: true,
			focou: true,
			body: t.Object({ lilith: t.Literal('Lilith') })
		}
	})
	.post('/', ({ body }) => body, {
		lilith: true
	})
