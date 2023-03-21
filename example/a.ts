import { Elysia, t } from '../src'

const a = (app: Elysia) => app.state('a', 'a')
const b = (app: Elysia) => app.state('b', 'b')

type B = ReturnType<typeof b> extends Elysia<infer A> ? A : false
type C = B['request']

const app = new Elysia()
	.post('/', ({ body }) => body, {
		schema: {
			body: t.Object({
				username: t.String(),
				password: t.String()
			})
		}
	})
	.listen(8080)

type A = typeof app
