import { Elysia, t } from '../src'

const delay = () => new Promise((r) => setTimeout(r, 1000))

const a = new Elysia({ prefix: '/course' }).group(
	'/id/:courseId',
	{
		params: t.Object({
			courseId: t.Numeric()
		})
	},
	(app) => app.get('/b', () => 'A')
)

console.log(a.routes.map((x) => x.path))

const app = new Elysia()
	.use(a)
	.model('a', t.String())
	.model((x) => x)
	.get('/', async () => {
		await delay()

		return 'a'
	})
	.listen(3000)

console.log(app.routes.map((x) => x.path))
// console.log(app.routes[1].composed?.toString())
