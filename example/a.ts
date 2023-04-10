import { Elysia, t } from '../src'

const html = () => (app: Elysia) =>
	app.decorate('html', (a: string) => new Response(a))

const page = ''

const app = new Elysia()
	.guard({}, (app) => app.use(html()).get('/html', ({ html }) => page))
	.get('/', () => page)
	.listen(8080)
