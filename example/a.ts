import { Elysia } from '../src'

const plugin = async (app: Elysia) => app.get('/', () => 'yay')

const app = new Elysia().use(plugin).onRequest(({ request }) => {
	console.info('API Request:', request.method, request.url)
})

await app.modules

app.handle(new Request('http://localhost:3000/'))
