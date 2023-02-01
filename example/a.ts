import { Elysia } from '../src'

const dyn = async (app: Elysia) =>
	app
		.get('/v1/genres', ({ params }) => {
			return 'statuse'
		})
		.get('/v1/genres/:id', ({ params }) => {
			return 'statuse'
		})
		.get('/v1/statuse', ({ params }) => {
			return 'statuse'
		})
		.get('/v1/statuse/:id', ({ params }) => {
			return params
		})

const app = new Elysia()
	.get('/', () => 'a')
	.use(dyn)
	.listen(3000)

// @ts-ignore
console.log(app.router.root['GET'])