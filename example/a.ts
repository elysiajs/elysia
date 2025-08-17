import { Elysia, t } from '../src'

new Elysia()
	.ws('/ws', {
		open(ws) {
			const { query } = ws.data
			console.log(query)
		},
		body: t.String({ minLength: 1 }),
		error({ error }) {
			console.log(error)
		}
	})
	.listen(3000)
