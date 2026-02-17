import { Elysia } from '../src'

const plugin = (app: Elysia) => app.get('/plugin', () => 'Plugin')
const asyncPlugin = async (app: Elysia) => app.get('/async', () => 'A')

const app = new Elysia()
	.decorate('a', () => 'hello')
	.use(plugin)
	.use(import('./lazy'))
	.use((app) => app.get('/inline', ({ store: { a } }) => 'inline'))
	.get('/', ({ a }) => a())
	.listen(3000)

await app.modules
const protocol = app.server?.tls ? "https" : "http"


console.log(
   `🔥 Elysia is running at ${protocol}://${app.server?.hostname}:${app.server?.port}`
)
