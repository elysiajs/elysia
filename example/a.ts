import { TypedSchema } from '../dist'
import { LocalHook } from '../dist/cjs'
import { Elysia, t } from '../src'

export const createSchema = (body: TypedSchema | undefined): LocalHook<any, any> => ({
	schema: {
		body
	}
})

const app = new Elysia()
	.get('/', () => {
		throw new Error('Unknown error: Hi')
	})
	.guard(
		{
			beforeHandle({ body }) {
				if (body.name.includes(' '))
					throw new Error("Shouldn't include space")
			},
			schema: {
				body: t.Object({
					name: t.String()
				})
			}
		},
		(app) => app.post('/', ({ body }) => body, {})
	)
	.group('/group', (app) => app.get('', () => 'empty').get('/', () => '/'))
	.get('/id/:id', (ctx) => {
		ctx.set.headers['x-powered-by'] = 'benchmark'

		return `${ctx.params.id} ${ctx.query.name}`
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
