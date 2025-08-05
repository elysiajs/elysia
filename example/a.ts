import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.get(
		'/',
		async () => {
			// `b: 2` should not be included, yet it is.
			return { keys: [{ a: 1, b: 2 }], extra: true }
		},
		{
			response: t.Object(
				{ keys: t.Array(t.Object({ a: t.Number() })) },
				{ additionalProperties: true }
			)
		}
	)
	.listen(3000)

// console.log(app.routes[0].compile().toString())
