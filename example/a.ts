import { Elysia } from '../src'
import { NodeAdapter } from '../src/adapter/node'

const app = new Elysia({ adapter: NodeAdapter, precompile: true })
	// .post('/json', ({ body }) => body, {
	// 	type: 'json'
	// })
	.get('/', ({ request }) => {
		throw new Error("AW")

		return true
	})
	// .get('/ok', () => {
	// 	return 'Ok'
	// })
	.compile()
	.listen(3000)
