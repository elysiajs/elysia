import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ headers }) => headers)
	.group(
		'/v1',
		{
			beforeHandle({ headers, set }) {
				// @ts-ignore
				if (!validateToken(headers)) {
					set.status = 401

					throw new Error('Invalid token')
				}
			},
			schema: {
				headers: t.Object({
					authorization: t.String()
				})
			}
		},
		(app) => app.post('/', () => {})
	)
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
