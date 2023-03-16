import { Elysia, t, SCHEMA, DEFS } from '../src'

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
	.post(
		'/file',
		({ set, a, A }) => {
			const file = Bun.file('')
			if (file.size === 0) {
				set.status = 404
				return 2
			}

			return file
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

const app2 = new Elysia()
	.setModel({
		string: t.String(),
		number: t.Number()
	})
	.setModel({
		boolean: t.Boolean()
	})
	.get('/', async (context) => Object.keys(context[DEFS]))

const res = await app2
	.handle(new Request('http://localhost:8080/'))
	.then((r) => r.text())

console.log(res)
