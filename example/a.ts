import { Elysia } from '../src'
import { ElysiaNodeContext, NodeAdapter } from '../src/adapter/node'
import { WebStandardAdapter } from '../src/adapter/web-standard'

const app = new Elysia({ adapter: WebStandardAdapter })
	.post('/', async ({ body, headers }) => {
		return {
			body,
			headers,
			env: typeof Bun !== 'undefined' ? 'bun' : 'likely Node'
		}
	})
	// .listen(3000)

Bun.serve({
	port: 3000,
	fetch: app.fetch
})
