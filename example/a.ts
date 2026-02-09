import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/health', () => ({ status: 'healthy' }) as const, {
		response: {
			200: t.Union([
				t.Object({
					status: t.Literal('a'),
					a: t.Object({ b: t.Integer() }) // <-- if you comment this line, you won't have an error
				}),
				t.Object({ status: t.Literal('healthy') })
			])
		}
	})
	.listen(3000)

app.handle(req('/health'))
	.then((x) => x.status)
	.then(console.log)
