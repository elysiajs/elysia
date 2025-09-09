import { Elysia, t } from '../src'

const a = <T>(a: T) => a
type a = typeof a

new Elysia()
	.macro({
		sartre: {
			body: t.Object({ sartre: t.Literal('Sartre') }),
		},
		focou: {
			body: t.Object({ focou: t.Literal('Focou') }),
		},
		lilith: {
			sartre: true,
			focou: true,
			body: t.Object({ lilith: t.Literal('Lilith') }),
		},
	})




	.post('/', ({ body }) => body, {
		lilith: true
	})
