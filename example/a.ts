import { Elysia, SCHEMA } from '../src'

const plugin = (app: Elysia) => app.get('/plugin', () => 'Plugin')
const asyncPlugin = async (app: Elysia) => app.get('/async', () => 'A')

const app = new Elysia()
	.use(plugin)
	.use(asyncPlugin)
	.use(import('./lazy'))
	.use((app) => app.get('/inline', () => 'inline'))
	.get('/', () => 'local')
	.listen(3000)

await app.modules

type A = typeof app['store'][typeof SCHEMA]

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
