import { Elysia, t } from '../src'

const route = new Elysia({ aot: false })
	.get('/valid', () => ({ foo: 'a' }), {
		afterHandle: () => ({ q: 'a' }),
		response: t.Object({
			foo: t.String()
		})
	})
	.listen(3000)

// console.log(route.routes[0].compile().toString())
