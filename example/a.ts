import { Elysia, t } from '../src'

const app = new Elysia()
	.guard(
		{
			response: {
				403: t.String()
			}
		},
		(app) =>
			app
				.get('/foo', () => 'bar', { response: { 200: t.String() } })
				.get('/bar', () => 12, { response: { 200: t.Integer() } })
	)
	.listen(3500)

console.log(app.routes[0].hooks.response['200'])
