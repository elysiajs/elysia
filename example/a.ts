import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.onRequest((ctx) => {
		console.log(ctx.server?.requestIP(ctx.request))
	})
	.get('/', () => 'Hello, World!')
	.listen(3000)

console.log(`Listening on http://${app.server!.hostname}:${app.server!.port}`)

async function test() {
	const response = await fetch('http://localhost:3000')
	console.log(await response.text())
}
test()
