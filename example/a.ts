import { Elysia, t } from '../src'

new Elysia()
	.get(
		'/',
		({ error }) => {
			const hello = false

			if (!hello) {
				return error(400)
			}

			return { example: 'Hello' }
		},
		{
			response: {
				200: t.Object({ example: t.String() })
			}
		}
	)
	.listen(8080)
