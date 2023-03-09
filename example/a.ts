import { Elysia, t, SCHEMA } from '../src'

export const plugin = (app: Elysia) =>
	app.group('/a', (app) =>
		app
			.setModel({
				sign: t.Object({
					username: t.String()
				})
			})
			.post(
				'/json/:id',
				({ body, params: { id }, query: { name } }) => 'h',
				{
					schema: {
						headers: 'sign',
						params: t.Object({
							id: t.Number()
						}),
						response: {
							200: t.String(),
							400: t.String()
						},
						detail: {
							summary: 'Transform path parameter'
						}
					}
				}
			)
	)

const app = new Elysia({
	serve: {
		// Max payload in byte
		maxRequestBodySize: 1024
	}
})
	.use(plugin)
	.get('/', (context) => context[SCHEMA])
	.listen(8080)
