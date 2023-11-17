import { Elysia, t } from '../src'

const app = new Elysia()
	.derive((app) => ({ someKey: 'someValue' }))
	.get('/', (ctx) => {
		console.log(ctx.someKey, typeof ctx.someKey) // Output : someValue string
	})
	.ws('/ws', {
		open(ws) {
			console.log(ws.data.someKey, typeof ws.data.someKey) // Output : someValue string, but IDE complains
		}
	})
	.listen(3000)
