import { Elysia, t } from '../src'

const a = new Elysia()
	.model({
		sign: t.Object({
			username: t.String(),
			password: t.String()
		})
	})
	.model(({ sign }) => ({
		signWithPagination: t.Object({
			results: sign,
			page: t.Number()
		})
	}))

const app = new Elysia()
	.use(a)
	.get('/', ({ set }) => {
		if(true)
			return set.status = 'Unauthorized'

		return 'Do something'
	})
	.post('/sign-in', ({ body }) => body, {
		body: 'signWithPagination'
	})
	.listen(3000)

console.log(app.routes.map((x) => x.path))
// console.log(app.routes[1].composed?.toString())
