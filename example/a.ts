// app-context.ts
import { Elysia, sse } from '../src'

const app = new Elysia()
	.get('/', () => 'hello world')
	.mapResponse(async ({ responseValue, set }) => {
		const compressed = Bun.gzipSync(responseValue as string)

		set.status = 201
		return new Response(compressed, {
			headers: {
				'Content-Encoding': 'gzip',
				'Content-Type': 'text/plain'
			}
		})
	})
	.get('/', () => 'Hello')
	.listen(3000)
