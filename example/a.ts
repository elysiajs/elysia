import { Elysia, status, t } from '../src'

const app = new Elysia()
	.get('/', ({ query }) => 'thing', {
		query: t.Object({
			a: t.Object({
				b: t.String()
			})
		})
	})
	.listen(3000)

console.log(app.routes[0].compile().toString())
