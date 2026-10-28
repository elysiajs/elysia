// A throwing wrap on a plain app must reach Bun's own error handler (500),
// not the start-up gate's 503 responder that reload() would otherwise keep
import { Elysia } from '../../../src'

const app = new Elysia()
	.wrap(() => () => {
		throw new Error('wrap-boom')
	})
	.get('/', () => 'root')
	.listen({ port: 0, hostname: '127.0.0.1' })

await Bun.sleep(30)
const response = await fetch(`http://127.0.0.1:${app.server!.port}/`)
console.log(`STATUS=${response.status}`)
await app.stop(true)
