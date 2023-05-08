import { Elysia, t } from '../src'

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
	.derive((context) => {
		return {
			a: 'b'
		}
	})
	.decorate('A', 'b')
	.post('/sign', ({ body }) => body, {
		schema: {
			body: t.Object({
				email: t.String({
					format: 'email'
				}),
				time: t.String({
					format: 'date-time'
				})
			}),
			response: t.Object({
				email: t.String({
					format: 'email'
				}),
				time: t.String({
					format: 'date-time'
				})
			})
		}
	})
	.post(
		'/file',
		({ set }) => {
			const file = Bun.file('')
			if (file.size === 0) {
				set.status = 404
				return file
			}

			return 2
		},
		{
			error({ set }) {},
			schema: {
				response: t.Object({
					200: t.File(),
					404: t.Number()
				})
			}
		}
	)
	.listen(8080)
